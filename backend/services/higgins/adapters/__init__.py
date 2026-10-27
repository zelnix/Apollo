"""Provider adapters: the only code that talks to an AI provider's SDK.

Each adapter turns ApolloSG's neutral request (services/higgins/ai_request.py) into its provider's call and returns an
AIResult in ApolloSG's terms. Adapters are called only by the gateway (services/higgins/provider.generate), after every
ApolloSG check has run. An adapter never retries, never switches model and never falls back to another provider.

A provider with no adapter here can be listed in ApolloSG Settings, but none of its models can be selected.
"""
from services.higgins.adapters import claude, gemini, gpt

ADAPTERS = {"gemini": gemini, "anthropic": claude, "openai": gpt}
