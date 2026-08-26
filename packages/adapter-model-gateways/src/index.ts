import { ProviderGateway } from "./provider-gateway.js";
import { ANTHROPIC_PROFILE, DEEPSEEK_PROFILE, OPENAI_PROFILE } from "./profiles.js";

export class OpenAIGateway extends ProviderGateway { public constructor() { super(OPENAI_PROFILE); } }
export class AnthropicGateway extends ProviderGateway { public constructor() { super(ANTHROPIC_PROFILE); } }
export class DeepSeekGateway extends ProviderGateway { public constructor() { super(DEEPSEEK_PROFILE); } }
export { ANTHROPIC_PROFILE, DEEPSEEK_PROFILE, OPENAI_PROFILE } from "./profiles.js";
export type { ProviderGatewayConfig, ProviderRequest, ProviderResponseSummary } from "./types.js";
