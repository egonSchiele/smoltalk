class SmolTalkClient {
  constructor() {
    // Initialization code here
  }

  prompt({
    model,
    messages,
  }: {
    model: string;
    messages: Array<{ role: string; content: string }>;
  }) {
    // Implementation for sending prompt to the model
    console.log(`Model: ${model}`);
    console.log("Messages:", messages);
  }
}

export default SmolTalkClient;
