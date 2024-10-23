## Developer Plugin

> [!WARNING]
> The plugin is NOT intended to be used in production environments. It's designed for the purpose of testing.

The Developer Plugin allows developers to inject an error to a connection and to verify how an application handles it.

Since some errors raised by the drivers rarely happen, testing for those might be difficult and require a lot of effort in building a testing environment. Errors associated with network outages are a good example of those errors. It may require substantial efforts to design and build a testing environment where such timeout errors could be produced with 100% accuracy and 100% guarantee. If a test suite can't produce and verify such cases with 100% accuracy it significantly decreases the value of such tests and makes the tests unstable and flaky. The Developer Plugin simplifies testing of such scenarios as shown below.

The `dev` plugin code should be added to the connection plugins parameter in order to be able to intercept calls and raise a test error when conditions are met.

### Simulate an error while opening a new connection

The plugin introduces a new class `ErrorSimulationManager` that will handle how a given error will be passed to the connection to be tested.

In order to raise a test error while opening a new connection, first create an instance of the error to be tested, then use `raiseErrorOnNextConnect` in `ErrorSimulationManager` so it will be triggered at next connection attempt.

Once the error is raised, it will be cleared and will not be raised again. This means that the next opened connection will not raise the error again.

```ts
params = {
  plugins: "dev"
};

const client = new AwsPGClient(params);

const testErrorToRaise: Error = new Error("test");
ErrorSimulatorManager.raiseErrorOnNextConnect(testErrorToRaise);

await client.connect(); // that throws the error

await client.connect(); // it goes normal with no error
```

### Simulate an error with already opened connection

It is possible to also simulate an error thrown in a connection after the connection has been opened.

Similar to previous case, the error is cleared up once it's raised and subsequent calls should behave normally.

```ts
params = {
  plugins: "dev"
};

const client = new AwsPGClient(params);
await client.connect();

const simulator: ErrorSimulator = client.getPluginInstance<ErrorSimulator>(DeveloperConnectionPlugin);
const testErrorToRaise: Error = new Error("test");
simulator.raiseErrorOnNextCall(testErrorToRaise, "query");

const result = await client.query("select 1"); // that throws the error
const anotherResult = await client.query("select 1"); // it goes normal with no error
```

It's possible to use a callback functions to check call parameters and decide whether to return an error or not. Check `ErrorSimulatorManager.setCallback` and `ErrorSimulator.setCallback` for more details.
