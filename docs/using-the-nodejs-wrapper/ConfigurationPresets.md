# Configuration Presets

## What is a Configuration Preset?

A Configuration Preset is a [configuration profile](./UsingTheNodejsWrapper.md#configuration-profiles) that has already been set up by the AWS Advanced NodeJS Wrapper team. Preset configuration profiles are optimized, profiled, verified and can be used right away. If the existing presets do not cover an exact use case, users can also create their own configuration profiles based on the built-in presets.

> [!WARNING]
> Configuration profiles can only be used to connect to PostgreSQL sources. An error will be thrown when attempting a connection to a MySQL source.

## Using Configuration Presets

The Configuration Preset name should be specified with the [`profileName`](./UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) parameter.

```typescript
const client = new AwsPGClient({
  ...
  profileName: "A2"
});
```

Users can create their own custom configuration profiles based on built-in configuration presets.

Users can not delete built-in configuration presets.

```typescript
// Create a new configuration profile "myNewProfile" based on "A2" configuration preset
ConfigurationProfileBuilder.get()
  .from("A2")
  .withName("myNewProfile")
  .withDatabaseDialect(new CustomDatabaseDialect())
  .buildAndSet();

const client = new AwsPGClient({
  ...
  profileName: "myNewProfile"
});
```

## Existing Configuration Presets

Configuration Presets are optimized for 3 main user scenarios. They are:

- **No connection pool** preset family: `A`, `B`, `C`
- AWS Advanced NodeJS Wrapper **Internal connection pool** preset family: `D`, `E`, `F`
- **External connection pool** preset family: `G`, `H`, `I`

Some preset names may include a number, like `A0`, `A1`, `A2`, `D0`, `D1`, etc. Usually, the number represent sensitivity or timing variations for the same preset. For example, `A0` is optimized for normal network outage sensitivity and normal response time, while `A1` is less sensitive. Please take into account that more aggressive presets tend to cause more false positive failure detections. More details can be found in this file: [configuration_profile_codes.ts](./../../common/lib/profile/configuration_profile_codes.ts)

Choosing the right configuration preset for your application can be a challenging task. Many presets could potentially fit the needs of your application. Various user application requirements and goals are presented in the following table and organized to help you identify the most suitable presets for your application.

PDF version of the following table can be found [here](./../files/configuration-profile-presets.pdf).

<div style="text-align:center"><img src="../images/configuration-presets.png" /></div>
