/**
 * Anbieter-unabhängige Schnittstelle für Bild-Editing.
 *
 * Regel: Ausserhalb von services/providers/ darf kein Anbieter-SDK und kein
 * Modellname vorkommen. Die App kennt nur Quality und TaskKind.
 */

export type Quality = 'eco' | 'hd' | 'ultra';
export type ProviderId = 'gemini' | 'fal';

/**
 * Wie ausführlich der Prompt sein darf.
 *
 * 'structured' – Gemini-artige Modelle verarbeiten lange, gegliederte Prompts
 *   mit Randbedingungen gut.
 * 'concise' – instruktionsbasierte Editoren wie FLUX Kontext folgen kurzen,
 *   direkten Anweisungen. Eine lange Liste aus Verboten verwässert dort die
 *   eigentliche Anweisung, das Ergebnis wird dann sichtbar zu zurückhaltend.
 */
export type PromptStyle = 'structured' | 'concise';

export type AspectRatio =
  | '1:1' | '2:3' | '3:2' | '3:4' | '4:3'
  | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

export type TaskKind =
  | 'exterior'
  | 'interior'
  /** Modell entscheidet selbst, ob innen oder aussen. */
  | 'auto'
  | 'stage-empty'
  | 'stage-furnish'
  | 'detail'
  | 'outdoor-furnish'
  | 'outpaint'
  | 'soften'
  /** Einzweck-Durchgang: nur Glanz und Spiegelungen entfernen. */
  | 'deglare'
  | 'custom';

export interface EditRequest {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  aspectRatio: AspectRatio;
  task: TaskKind;
  signal?: AbortSignal;
}

export interface EditResult {
  base64: string;
  mimeType: string;
  modelId: string;
  costUsd: number;
}

export interface ModelDescriptor {
  /** Interne ID, z.B. 'gemini:2.5-flash-image'. Wird geloggt und gecacht. */
  id: string;
  providerId: ProviderId;
  /** Name, den die Anbieter-API erwartet. */
  nativeId: string;
  label: string;
  quality: Quality;
  /**
   * Geschätzte Kosten pro Bild in USD. Bewusst am Modell und nicht im
   * usageService: Preise ändern sich, pro Modell ist die ehrliche Granularität.
   */
  costUsd: number;
  /** Kantenlänge, auf die vor dem Upload verkleinert wird. */
  uploadMaxEdge: number;
  /**
   * Ungefähre Ausgabegröße in Megapixeln.
   *
   * Bewusst als eigenes Feld: Modelle wurden bisher nach Stufe und Preis
   * einsortiert, aber nie nach dem, was am Ende herauskommt. FLUX Kontext und
   * Nano Banana kosteten fast gleich viel und standen beide unter Eco – nur
   * lieferte das eine viermal so viele Pixel wie das andere.
   */
  outputMp: number;
  promptStyle: PromptStyle;
  supports: { outpaint: boolean; aspectRatio: boolean };
}

export type ErrorKind =
  | 'auth' | 'rate-limit' | 'quota' | 'safety'
  | 'no-image' | 'unsupported' | 'network' | 'unknown';

export class ProviderError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public retryable: boolean,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface Provider {
  id: ProviderId;
  label: string;
  keyUrl: string;
  keyPlaceholder: string;
  models: ModelDescriptor[];
  edit(model: ModelDescriptor, req: EditRequest, apiKey: string): Promise<EditResult>;
}
