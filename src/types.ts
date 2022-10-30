export type WordQueryResponse = {
  /**
   * Empty string means it's just a dummy response.
   */
  upstream: '' | 'saol' | 'so' | 'glosbe' | 'reverso';
  baseform: string;
  compounds: string[];
  compoundsLemma: string[];
  definitions: string[];
};
