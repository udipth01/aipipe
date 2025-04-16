let openrouterModels;

export const providers = {
  openrouter: {
    base: "https://openrouter.ai/api",
    key: "OPENROUTER_API_KEY",
    cost: async ({ model, usage }) => {
      // If we need to look up a model (and it's not present), download model list again
      if (model && (!openrouterModels || !openrouterModels?.data.find((d) => d.id == model)))
        openrouterModels = await fetch("https://openrouter.ai/api/v1/models").then((res) => res.json());
      const { pricing } = openrouterModels?.data?.find?.((d) => d.id == model) ?? {};
      const cost =
        // TODO: Add image, web_search, internal_reasoning costs
        (usage?.prompt_tokens * pricing?.prompt || 0) +
        (usage?.completion_tokens * pricing?.completion || 0) +
        (+pricing?.request || 0);
      return { cost };
    },
  },
  openai: {
    base: "https://api.openai.com",
    key: "OPENAI_API_KEY",
    // TODO: Add stream_options: {include_usage: true} if streaming
  },
};
