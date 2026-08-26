import { createHash, timingSafeEqual } from "node:crypto";
import type { ApiAuthenticator, ApiPrincipal, ApiScope } from "./contracts.js";

export interface StaticBearerCredential { readonly token: string; readonly subject: string; readonly scopes: readonly ApiScope[]; }
export class StaticBearerAuthenticator implements ApiAuthenticator {
  private readonly credentials: readonly { digest: Buffer; principal: ApiPrincipal }[];
  public constructor(credentials: readonly StaticBearerCredential[]) {
    if (credentials.length === 0) throw new TypeError("At least one API credential is required");
    this.credentials = credentials.map((value) => {
      if (value.token.length < 16) throw new TypeError("API bearer tokens must contain at least 16 characters");
      return { digest: digest(value.token), principal: { subject: required(value.subject, "credential subject"), scopes: [...new Set(value.scopes)] } };
    });
  }
  public async authenticate(request: Request): Promise<ApiPrincipal | null> {
    const match = /^Bearer\s+(.+)$/iu.exec(request.headers.get("authorization") ?? "");
    if (!match?.[1]) return null;
    const candidate = digest(match[1]);
    for (const credential of this.credentials) if (timingSafeEqual(candidate, credential.digest)) return credential.principal;
    return null;
  }
}
function digest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function required(value: string, name: string): string { if (value.trim() === "") throw new TypeError(`${name} is required`); return value; }
