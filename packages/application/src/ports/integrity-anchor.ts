export interface AnchorReceipt {
  readonly anchorId: string;
  readonly rootHash: string;
  readonly anchoredAt: string;
  readonly sequence: number;
  readonly previousReceiptHash: string | null;
  readonly receiptHash: string;
  readonly signature: string;
  readonly adapter: string;
}

export interface IntegrityAnchor {
  anchor(rootHash: string): Promise<AnchorReceipt>;
  verify(rootHash: string, receipt: AnchorReceipt): Promise<boolean>;
}
