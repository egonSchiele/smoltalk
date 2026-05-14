export type LoadProgress = {
  stage: "downloading" | "compiling" | "ready";
  loaded: number;
  total: number;
  text?: string;
};

export type LoadOptions = {
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
};

export type CustomModel = {
  id: string;
  modelUrl: string;
  modelLibUrl: string;
  contextWindow: number;
  maxOutputTokens?: number;
};

export type LoadInput = string | CustomModel;
