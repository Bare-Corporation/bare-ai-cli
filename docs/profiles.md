# bare-ai install profiles: .pro (native Anthropic + caching) vs .me (OpenAI-spec)

One binary; profiles set defaults only. The client auto-selects the wire dialect
from the endpoint: native Anthropic Messages (+ prompt caching) when the target
is .../v1/messages; OpenAI chat-completions dialect everywhere else.

## Usage

    bash scripts/install-profile.sh pro   # -> https://api.anthropic.com/v1/messages (Claude)
    bash scripts/install-profile.sh me    # -> https://api.bare-ai.net (multi-model council)

Optional: --model <model_id> and --key <value> (key file chmod 600). Writes
~/.bare-ai/profile.env (atomic). Source it in your shell rc or export it.

Public install hosts: bare-ai.me/install.sh (OpenAI-spec default) and
bare-ai.pro/install.sh (native Anthropic default). bare-ai.pro origin is pending
landing-worker wiring (DNS present; CF 525 until origin added).

## Verification

- .pro: two sequential calls, identical prefix >=1024 tokens -> first shows
  CacheWrite, second CachedRead in [Telemetry].
- .me: OpenAI-compat response, no cache fields.
