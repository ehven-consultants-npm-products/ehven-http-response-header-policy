export type HeaderRule =
  | { readonly action: 'default' | 'enforce'; readonly value: string }
  | { readonly action: 'skip' | 'remove'; readonly value?: never };

export interface PolicyOptions {
  /** Include built-in defaults. Defaults to true; does not disable explicit rules. */
  readonly defaults?: boolean;
  /** Header names are case-insensitive. A later rule replaces the entire earlier rule. */
  readonly headers?: Readonly<Record<string, HeaderRule>>;
}

export interface ResponseHeaderPolicy {
  /** New ordinary HTTP Response sharing the original unread body stream. */
  apply(response: Response, overrides?: PolicyOptions): Response;
  /** New Headers for host-owned response construction, including encoded responses. */
  applyHeaders(headers: HeadersInit, overrides?: PolicyOptions): Headers;
}

export declare function createResponseHeaderPolicy(options?: PolicyOptions): ResponseHeaderPolicy;
export declare function applyResponseHeaderPolicy(response: Response, options?: PolicyOptions): Response;
