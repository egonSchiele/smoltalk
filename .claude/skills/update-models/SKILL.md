---
name: update-models
description: Update model data in lib/models.ts with latest specifications from every provider in the registry (OpenAI, Anthropic, Google, Groq)
---

# Update Model Data Skill

This skill updates the model specifications in `lib/models.ts` with the latest data from every provider that has baked-in catalog entries.

## Instructions

When invoked, follow these steps:

### 1. Read Current Model Data

First, read the current `lib/models.ts` file to understand the existing structure and models.

**Then determine which providers to refresh — do not rely on the list in this file.** From `packages/smoltalk/`, run:

```bash
grep -oE 'provider: "[a-z-]+"' lib/models.ts | sort -u
```

Every provider that comes back is in scope for this run. Steps 2–5 below cover the providers present when this skill was last revised; if the grep returns one that has no step, refresh it anyway using the same fields, and add a step for it. A provider silently dropping out of the refresh is the failure mode this check exists to prevent — it is how `claude-opus-5` sat missing from the catalog for six weeks across two "update models" runs.

Note that the grep also matches the `hostedTools` registry at the bottom of the file, so a provider may appear there with no model entries of its own (`openrouter` is currently one). Those are tools, not models — refresh their pricing in step 6, and don't go looking for models the provider doesn't have in the catalog.

For each provider, gather:

- Model names and IDs
- Context windows (max input and output tokens)
- Pricing per million tokens (input, cached input, cache write, output)
- Model descriptions and capabilities
- Knowledge cutoff and release dates
- Reasoning/thinking support (levels, defaults, whether it can be disabled)
- Any deprecation or retirement notices

### 2. Fetch Latest OpenAI Model Information

Official pricing: https://developers.openai.com/api/docs/pricing

Cover the current flagship line plus whatever is newer, and check the older families still in the catalog for price changes and retirements. Note tiered long-context pricing (rates above the context threshold) where it applies, and which models are Responses-API-only (`openai-responses` provider).

### 3. Fetch Latest Anthropic Model Information

Official pricing: https://platform.claude.com/docs/en/about-claude/pricing
Model catalog: https://platform.claude.com/docs/en/about-claude/models/overview

Cover the Fable, Opus, Sonnet, and Haiku tiers. Anthropic-specific things to get right:

- **Cache read multiplier is not always 0.1x.** It is 0.1x of base input on most models, but some price cache hits differently (Fable 5.1 is 0.025x). Read the multiplier off the pricing table rather than computing it.
- `cacheCreationInputTokenCost` is the **5-minute** cache write (1.25x base input), not the 1-hour rate.
- Set `reasoning.thinkingStyle`: `"adaptive"` for models taking `thinking: {type: "adaptive"}` + `output_config.effort`, `"budget"` for older models taking `budget_tokens`.
- Skip limited-availability models with no general access path (e.g. Project Glasswing models) — there is no public pricing to record.

### 4. Fetch Latest Google Gemini Model Information

Official pricing: https://ai.google.dev/gemini-api/docs/pricing
Model catalog: https://ai.google.dev/gemini-api/docs/models

Cover the current Pro, Flash, and Flash-Lite lines, image generation models, and embeddings. Note tiered pricing above the 200k-token threshold (`longContext`), and that thinking-level support varies by model — some reject `minimal`.

### 5. Fetch Latest Groq Model Information

Official pricing: https://groq.com/pricing

Groq entries are speech-to-text and text-to-speech models (`perMinuteCost` / `perCharacterCost`), not text models. Check the minimum billable duration and upload caps as well as the rates.

### 6. Update the Models File

For each model that needs updating:

- Update pricing if it has changed
- Update context windows if they've changed
- Update descriptions with new capabilities
- Add new models that are production-ready
- Mark deprecated models with `disabled: true` and add deprecation notices
- Ensure all pricing is in dollars per million tokens
- Verify `maxInputTokens` and `maxOutputTokens` are accurate

Also refresh the `hostedTools` registry in the same file — per-call rates, free allowances, and the `models` allowlists that gate a tool to specific model IDs. A new model added above often belongs in one of those allowlists (e.g. `maps_grounding`), and that is easy to miss when only the model arrays are in view.

### 7. Fetch performance data

If available, fetch any performance benchmarks or latency information for the models to set the `outputTokensPerSecond` field on models. Here's a site that provides this data:
https://artificialanalysis.ai/leaderboards/models

### 8. Verify Changes

After making updates:

- Read the updated sections to verify correctness
- Run `pnpm typecheck` and `pnpm test` in `packages/smoltalk/`
- Check that new models follow the existing type structure
- Verify that pricing information is accurate

### 9. Provide Summary

Create a clear summary for the user showing:

- Which models were updated
- What changes were made (pricing, context windows, descriptions)
- Which models were added
- Which models were deprecated
- **Which providers were checked and found unchanged** — so a provider that was skipped is visible rather than implied to be current
- Links to official documentation sources

## Important Notes

- Always cite official sources (the vendor's own pricing and model docs)
- Use WebSearch to find current documentation pages
- Prefer official API documentation over third-party sources
- When WebFetch fails, use multiple search queries to gather complete information
- Be conservative with updates - only change what's clearly documented
- Include sources at the end of your response as markdown links
- For models with tiered pricing (e.g., different rates above 200k tokens), note this in the description
- Update text, image, embeddings, speech-to-text, and text-to-speech models as applicable
- **Never encode a future price in the cost fields.** When a rate is introductory or a change is scheduled, put today's actual rate in `inputTokenCost` / `outputTokenCost` / etc. and describe the scheduled change in the `description`. Pre-loading the expected future price makes the entry silently wrong the moment the date passes — and wrong permanently if the change is later cancelled, which is what happened to `claude-sonnet-5`.
- When a model's description references a date that has already passed, re-verify that entry against the vendor's current pricing rather than trusting it.

## Example Usage

User can invoke this skill by typing:

```
/update-models
```

or

```
Please update the model data
```
