export type Session = {
    id: number;
    userId: number;
    sequenceNumber: number;
    token: Uint8Array<ArrayBuffer>;
    lastUsed: number;
    data: [string, any][];
};
