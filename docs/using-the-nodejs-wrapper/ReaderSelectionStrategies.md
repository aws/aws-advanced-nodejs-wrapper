## Reader Selection Strategies

To balance connections to reader instances more evenly, different selection strategies can be used. The following table describes the currently available selection strategies and any relevant configuration parameters for each strategy.

| Reader Selection Strategy | Configuration Parameter                               | Description                                                                                                                                                                      | Default Value |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `random`                  | This strategy does not have configuration parameters. | The random strategy is the default selection strategy. When switching to a reader connection, the reader instance will be chosen randomly from the available database instances. | N/A           |
