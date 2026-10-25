/** Σφάλμα φόρτωσης με μήνυμα για τον χρήστη (ελληνικά) και προαιρετική τεχνική λεπτομέρεια. */
export class ModelError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'ModelError';
    this.detail = detail;
  }
}

export const corrupt = (kind: string, detail?: string) =>
  new ModelError(`Το αρχείο φαίνεται κατεστραμμένο ή δεν είναι έγκυρο ${kind}.`, detail);

export const technical = (e: unknown): string | undefined =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : undefined;
