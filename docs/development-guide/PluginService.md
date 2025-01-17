## Plugin Service

![](../images/plugin_service.png)

The plugin service retrieves and updates the current connection and its relevant host information.

It also keeps track of the host list provider in use, and notifies it to update its host list.

It is expected that the plugins do not establish a connection themselves, but rather call `PluginService.connect()`
to establish connections.

## Host List Providers

The plugin service uses the host list provider to retrieve the most recent host information or topology information about the database.

The AWS Advanced NodeJS Wrapper has two host list providers, the `ConnectionStringHostListProvider` and the `RdsHostListProvider`.

The `ConnectionStringHostListProvider` is the default provider, it parses the host parameter for cluster information and stores the information.
The provider supports having multiple hosts in the host parameter:

| Host parameter                  | Support            |
| ------------------------------- | ------------------ |
| `hostname1,hostname2`           | :x:                |
| `hostname1,hostname2:8090`      | :x:                |
| `hostname1:8090,hostname2`      | :white_check_mark: |
| `hostname1:8090,hostname2:8090` | :white_check_mark: |

The `RdsHostListProvider` provides information about the Aurora cluster.
It uses the current connection to track the available hosts and their roles in the cluster.

The `ConnectionStringHostListProvider` is a static host list provider, whereas the `RdsHostListProvider` is a dynamic host list provider.
A static host list provider will fetch the host list during initialization and does not update the host list afterward,
whereas a dynamic host list provider will update the host list information based on database status.
When implementing a custom host list provider, implement either the `StaticHostListProvider` or the `DynamicHostListProvider` marker interfaces to specify its provider type.
