- streaming tool calls (for partial ui updates)
- To explore: if a model returns thinking blocks and we want to switch to using a different model, can we convert those thinking blocks into assistant messages that use a <thinking> tag?

- todo: add ability to use a model config as a strategy

- use this for more accurate token estimates: https://www.npmjs.com/package/gpt-tokenizer

Does it make sense to get rid of the ModelConfig idea? The idea was to let Smoltalk pick the model best suited to a use case, but it's adding complexity and I'm not sure if it's a good fit with the new strategies approach.
If modelconfig should be kept, we probably need to update the fastest strategy as well as other strategies to accept it, which means modelconfig needs to be parsable as a strategy.