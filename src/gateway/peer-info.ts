/**
 * Gateway-stamped, non-spoofable provenance for inbound WS messages.
 *
 * The `__gatewayPeerStamp` brand makes this type only constructible via
 * `stampGatewayPeerInfo`. Channel plugins, auto-reply paths, and tests
 * cannot fabricate a `GatewayPeerInfo` value — they cannot fill in the
 * branded sentinel because the `Symbol` is not exported.
 *
 * Trust-tier classifiers (e.g. ryn-security) consume this from
 * `inbound_claim` event `metadata.source` to decide whether a connection
 * is genuinely from the gateway control-UI on loopback (a precondition
 * for principal-tier grant) versus a remote or spoofed claim.
 */
const GATEWAY_PEER_BRAND: unique symbol = Symbol("openclaw.gateway.peer-info");

export type GatewayPeerInfo = {
  readonly [GATEWAY_PEER_BRAND]: true;
  readonly isLoopback: boolean;
  readonly peerAddress: string | undefined;
  readonly clientId: string;
  readonly connectionScopes: readonly string[];
};

export function stampGatewayPeerInfo(params: {
  isLoopback: boolean;
  peerAddress: string | undefined;
  clientId: string;
  connectionScopes: readonly string[];
}): GatewayPeerInfo {
  return {
    [GATEWAY_PEER_BRAND]: true,
    isLoopback: params.isLoopback,
    peerAddress: params.peerAddress,
    clientId: params.clientId,
    connectionScopes: Object.freeze([...params.connectionScopes]),
  };
}

/**
 * Plain shape for plugin event metadata. The brand is dropped before the
 * value crosses into plugin-visible territory; plugins consume an opaque
 * record to avoid coupling on the brand symbol.
 */
export type PluginInboundSourceMetadata = {
  readonly isLoopback: boolean;
  readonly peerAddress: string | undefined;
  readonly clientId: string;
  readonly connectionScopes: readonly string[];
};

export function toPluginInboundSourceMetadata(info: GatewayPeerInfo): PluginInboundSourceMetadata {
  return {
    isLoopback: info.isLoopback,
    peerAddress: info.peerAddress,
    clientId: info.clientId,
    connectionScopes: info.connectionScopes,
  };
}
