// Ελάχιστη δήλωση: χρησιμοποιούμε μόνο το parse (το αποτέλεσμα περιγράφεται από το GlyphFont).
declare module 'opentype.js' {
  export function parse(buffer: ArrayBuffer): unknown;
}
