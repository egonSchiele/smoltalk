---
name: update-models
description: Update model data in lib/models.ts with latest specifications from OpenAI and Google APIs
---

# Update Model Data Skill

This skill updates the model specifications in `lib/models.ts` with the latest data from OpenAI and Google (Gemini) APIs.

## Instructions

When invoked, follow these steps:

### 1. Read Current Model Data
First, read the current `lib/models.ts` file to understand the existing structure and models.

### 2. Fetch Latest OpenAI Model Information
Search for and fetch the latest OpenAI model specifications:
- Model names and IDs
- Context windows (max input and output tokens)
- Pricing per million tokens (input, cached input, output)
- Model descriptions and capabilities
- Knowledge cutoff dates
- Any deprecation notices

Focus on these model families:
- GPT-4o and GPT-4o-mini
- o-series (o1, o3, o4-mini, etc.)
- GPT-4.1
- Any new production-ready models

### 3. Fetch Latest Google Gemini Model Information
Search for and fetch the latest Google Gemini model specifications:
- Model names and IDs
- Context windows (max input and output tokens)
- Pricing per million tokens/characters (input and output)
- Model descriptions and features
- Tiered pricing information (if applicable)
- Special features (context caching, batch API, etc.)
- Any deprecation notices

Focus on these model families:
- Gemini 3 Pro and Flash
- Gemini 2.5 Pro, Flash, and Flash-Lite
- Gemini 2.0 models
- Image generation models (Gemini Pro Image, etc.)

### 4. Update the Models File
For each model that needs updating:
- Update pricing if it has changed
- Update context windows if they've changed
- Update descriptions with new capabilities
- Add new models that are production-ready
- Mark deprecated models with `disabled: true` and add deprecation notices
- Ensure all pricing is in dollars per million tokens
- Verify `maxInputTokens` and `maxOutputTokens` are accurate

### 5. Verify Changes
After making updates:
- Read the updated sections to verify correctness
- Ensure TypeScript syntax is valid
- Check that new models follow the existing type structure
- Verify that pricing information is accurate

### 6. Provide Summary
Create a clear summary for the user showing:
- Which models were updated
- What changes were made (pricing, context windows, descriptions)
- Which models were added
- Which models were deprecated
- Links to official documentation sources

## Important Notes

- Always cite official sources (OpenAI and Google documentation)
- Use WebSearch to find current documentation pages
- Prefer official API documentation over third-party sources
- When WebFetch fails, use multiple search queries to gather complete information
- Be conservative with updates - only change what's clearly documented
- Include sources at the end of your response as markdown links
- For models with tiered pricing (e.g., different rates above 200k tokens), note this in the description
- Update both text and image models if applicable

## Example Usage

User can invoke this skill by typing:
```
/update-models
```

or

```
Please update the model data
```
