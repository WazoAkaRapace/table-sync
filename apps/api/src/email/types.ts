/**
 * Contrat provider-agnostique des emails transactionnels. Mailjet est l'adapter
 * n°1 (providers/mailjet.ts) ; un futur SMTP/Resend/SendGrid = un fichier de
 * plus ici + sa sélection dans config.ts. Aucun type provider-specific ne doit
 * fuiter hors de providers/.
 */

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  /** Version texte brut — toujours fournie (repli des clients e-mail). */
  text: string;
  /** HTML inline-CSS simple (pas de classes : les webmails les retirent). */
  html: string;
}

export interface EmailProvider {
  readonly name: string;
  /** Échec = exception avec message exploitable dans les logs. */
  send(message: EmailMessage): Promise<void>;
}
