import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnchorReceipt, Clock, IdGenerator, IntegrityAnchor } from "@traceforge/application";
import { canonicalize, sha256, type CanonicalJsonValue } from "@traceforge/crypto";

type ReceiptCore = Omit<AnchorReceipt, "receiptHash" | "signature">;

export class LocalAnchorAdapter implements IntegrityAnchor {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly signingKey: Uint8Array;

  public constructor(
    private readonly ledgerPath: string,
    signingKey: Uint8Array,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {
    if (signingKey.byteLength < 32) throw new TypeError("Local anchor signing key must be at least 32 bytes");
    this.signingKey = signingKey.slice();
  }

  public anchor(rootHash: string): Promise<AnchorReceipt> {
    validateRoot(rootHash);
    const result = this.tail.then(() => this.append(rootHash));
    this.tail = result.catch(() => undefined);
    return result;
  }

  public async verify(rootHash: string, receipt: AnchorReceipt): Promise<boolean> {
    if (rootHash !== receipt.rootHash || receipt.adapter !== "local-hmac-sha256") return false;
    const { receiptHash, signature, ...core } = receipt;
    const calculatedHash = sha256(canonicalize(core as unknown as CanonicalJsonValue));
    if (calculatedHash !== receiptHash) return false;
    const calculatedSignature = this.sign(receiptHash);
    const left = Buffer.from(signature, "base64");
    const right = Buffer.from(calculatedSignature, "base64");
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
  }

  private async append(rootHash: string): Promise<AnchorReceipt> {
    const ledger = await this.readLedger();
    let prior: AnchorReceipt | null = null;
    for (const receipt of ledger) {
      const valid = await this.verify(receipt.rootHash, receipt)
        && receipt.sequence === (prior?.sequence ?? 0) + 1
        && receipt.previousReceiptHash === (prior?.receiptHash ?? null);
      if (!valid) throw new Error("Local anchor ledger integrity verification failed");
      prior = receipt;
    }
    const previous = ledger.at(-1) ?? null;
    const core: ReceiptCore = {
      anchorId: this.ids.generate(), rootHash, anchoredAt: this.clock.now().toISOString(),
      sequence: (previous?.sequence ?? 0) + 1,
      previousReceiptHash: previous?.receiptHash ?? null,
      adapter: "local-hmac-sha256"
    };
    const receiptHash = sha256(canonicalize(core as unknown as CanonicalJsonValue));
    const receipt: AnchorReceipt = { ...core, receiptHash, signature: this.sign(receiptHash) };
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    await appendFile(this.ledgerPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "a" });
    return receipt;
  }

  private async readLedger(): Promise<AnchorReceipt[]> {
    try {
      const value = await readFile(this.ledgerPath, "utf8");
      return value.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as AnchorReceipt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private sign(receiptHash: string): string {
    return createHmac("sha256", this.signingKey).update(receiptHash, "utf8").digest("base64");
  }
}

function validateRoot(rootHash: string): void {
  if (!/^[a-f0-9]{64}$/u.test(rootHash)) throw new TypeError("Root hash must be a lowercase SHA-256 digest");
}
