/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

const MESSAGES: Record<string, string> = {
  "PluginManager.unknownPluginCode": "Unknown plugin code: '%s'",
  "PluginManager.unknownPluginWeight": "Unknown plugin weight for %s.",
  "PluginManager.pipelineNone": "A pipeline was requested but the created pipeline evaluated to undefined.",
  "PluginManager.unableToRetrievePlugin": "Unable to retrieve plugin instance.",
  "ConnectionProvider.unsupportedHostSelectorStrategy":
    "Unsupported host selection strategy '%s' specified for this connection provider '%s'. Please visit the documentation for all supported strategies.",
  "ConnectionPluginChainBuilder.errorImportingPlugin":
    "The plugin could not be imported due to error '%s'. Please ensure the required dependencies have been installed. Plugin: '%s'",
  "ClientUtils.queryTaskTimeout":
    "Client query task timed out, if a network error did not occur, please review the usage of the 'wrapperQueryTimeout' connection parameter.",
  "ClientUtils.connectTimeout": "Client connect timed out.",
  "Client.undefinedTargetClient": "targetClient is undefined, this code should not be reachable.",
  "DatabaseDialectManager.unknownDialectCode": "Unknown dialect code: '%s'.",
  "DatabaseDialectManager.getDialectError": "Was not able to get a database dialect.",
  "DatabaseDialectManager.wrongCustomDialect": "Provided custom database dialect should implement DatabaseDialect.",
  "DefaultPlugin.executingMethod": "Executing method: %s",
  "DefaultConnectionPlugin.unknownRoleRequested":
    "A HostInfo with a role of HostRole.UNKNOWN was requested via getHostInfoByStrategy. The requested role must be either HostRole.WRITER or HostRole.READER",
  "DefaultConnectionPlugin.noHostsAvailable": "The default connection plugin received an empty host list from the plugin service.",
  "HostSelector.noHostsMatchingRole": "No hosts were found matching the requested '%s' role.",
  "HostListProviderService.notFound": "HostListProviderService not found.",
  "HostInfo.noHostParameter": "Host parameter must be set, HostInfo not found or not provided.",
  "HostInfo.weightLessThanZero": "A HostInfo object was created with a weight value less than 0.",
  "AwsSecretsManagerConnectionPlugin.failedToFetchDbCredentials":
    "Was not able to either fetch or read the database credentials from AWS Secrets Manager due to error: %s. Ensure the correct secretId and region properties have been provided.",
  "AwsSecretsManagerConnectionPlugin.emptySecretValue":
    "Unable to fetch database credentials with the given username key and password key. Please review the values specified in secretUsernameProperty (%s) and secretPasswordProperty (%s) and ensure they match the Secrets Manager JSON format.",
  "AwsSecretsManagerConnectionPlugin.missingRequiredConfigParameter": "Configuration parameter '%s' is required.",
  "AwsSecretsManagerConnectionPlugin.emptyPropertyKeys":
    "secretUsernameProperty and secretPasswordProperty cannot be empty strings. Please ensure they are correct and match the Secret value's JSON format.",
  "AwsSecretsManagerConnectionPlugin.invalidExpirationTime": "The expiration time (%s) must be set to a non-negative value.",
  "AwsSecretsManagerConnectionPlugin.unhandledError": "Unhandled error: '%s'",
  "AwsSecretsManagerConnectionPlugin.endpointOverrideInvalidConnection": "A connection to the provided endpoint could not be established: '%s'.",
  "ClusterAwareReaderFailoverHandler.invalidTopology": "'%s' was called with an invalid (null or empty) topology",
  "ClusterAwareReaderFailoverHandler.attemptingReaderConnection": "Trying to connect to reader: '%s', with properties '%s'",
  "ClusterAwareReaderFailoverHandler.successfulReaderConnection": "Connected to reader: '%s'",
  "ClusterAwareReaderFailoverHandler.failedReaderConnection": "Failed to connect to reader: '%s'",
  "ClusterAwareReaderFailoverHandler.batchFailed": "Reader connections for hosts [%s] failed with the following errors: %s",
  "ClusterAwareReaderFailoverHandler.selectedTaskChosen": "Selected task has already been chosen. Abort client for host: %s",
  "Utils.topology": "Topology: %s",
  "RdsHostListProvider.incorrectDialect": "Dialect needs to be a topology aware dialect.",
  "RdsHostListProvider.noClusterId": "No clusterId found. Please ensure clusterId parameter is set to a non-empty string.",
  "ConnectionStringHostListProvider.parsedListEmpty": "Can't parse connection string: '%s'.",
  "ConnectionStringHostListProvider.errorIdentifyConnection": "An error occurred while obtaining the connection's host ID.",
  "ExecuteTimePlugin.executeTime": "Executed method '%s' in %s milliseconds.",
  "ConnectTimePlugin.connectTime": "Connected to '%s' in %s milliseconds.",
  "ClusterAwareWriterFailoverHandler.failoverCalledWithInvalidTopology": "Failover was called with an invalid (null or empty) topology.",
  "ClusterAwareWriterFailoverHandler.failedToConnectToWriterInstance": "Failed to connect to the writer instance.",
  "ClusterAwareWriterFailoverHandler.successfulConnectionInvalidTopology":
    "'%s' successfully established a connection but doesn't contain a valid topology.",
  "ClusterAwareWriterFailoverHandler.successfullyConnectedToNewWriterInstance": "Successfully connected to the new writer instance: '%s'- '%s'",
  "ClusterAwareWriterFailoverHandler.successfullyReconnectedToWriterInstance": "Successfully re-connected to the current writer instance: '%s'- '%s'",
  "ClusterAwareWriterFailoverHandler.taskAAttemptReconnectToWriterInstance":
    "[TaskA] Attempting to re-connect to the current writer instance: '%s', with properties '%s'",
  "ClusterAwareWriterFailoverHandler.taskAEncounteredError": "[TaskA] encountered an error: '%s'",
  "ClusterAwareWriterFailoverHandler.taskAFinished": "[TaskA] Finished",
  "ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriterInstance":
    "[TaskB] Attempting to connect to a new writer instance, with properties '%s'",
  "ClusterAwareWriterFailoverHandler.taskBEncounteredError": "[TaskB] encountered an error: '%s'",
  "ClusterAwareWriterFailoverHandler.taskBFinished": "[TaskB] Finished",
  "ClusterAwareWriterFailoverHandler.taskBConnectedToReader": "[TaskB] Connected to reader: '%s'",
  "ClusterAwareWriterFailoverHandler.taskBFailedToConnectToAnyReader": "[TaskB] Failed to connect to any reader.",
  "ClusterAwareWriterFailoverHandler.standaloneHost": "[TaskB] Host %s is not yet connected to a cluster. The cluster is still being reconfigured.",
  "ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriter": "[TaskB] Trying to connect to a new writer: '%s'",
  "ClusterAwareWriterFailoverHandler.alreadyWriter": "Current reader connection is actually a new writer connection.",
  "ClusterAwareReaderFailoverHandler.errorGettingHostRole": "An error occurred while trying to determine the role of the reader candidate: %s.",
  "Failover.TransactionResolutionUnknownError":
    "Transaction resolution unknown. Please re-configure session state if required and try restarting the transaction.",
  "Failover.connectionChangedError":
    "The active SQL connection has changed due to a connection failure. Please re-configure session state if required.",
  "Failover.parameterValue": "%s = %s",
  "Failover.unableToConnectToWriter": "Unable to establish SQL connection to the writer instance.",
  "Failover.unableToConnectToWriterDueToError": "Unable to establish SQL connection to the writer instance: %s due to error: %s.",
  "Failover.unableToConnectToReader": "Unable to establish SQL connection to the reader instance.",
  "Failover.unableToDetermineWriter": "Unable to determine the current writer instance.",
  "Failover.detectedError": "[Failover] Detected an error while executing a command: %s",
  "Failover.failoverDisabled": "Cluster-aware failover is disabled.",
  "Failover.establishedConnection": "[Failover] Connected to %s",
  "Failover.startWriterFailover": "Starting writer failover procedure.",
  "Failover.startReaderFailover": "Starting reader failover procedure.",
  "Failover.invalidHost": "Host is no longer available in the topology: %s",
  "Failover.noOperationsAfterConnectionClosed": "No operations allowed after client ended.",
  "Failover.transactionResolutionUnknownError": "Unknown transaction resolution error occurred during failover.",
  "Failover.connectionExplicitlyClosed": "Unable to failover on an explicitly closed connection.",
  "Failover.timeoutError": "Internal failover task has timed out.",
  "Failover.newWriterNotAllowed":
    "The failover process identified the new writer but the host is not in the list of allowed hosts. New writer host: '%s'. Allowed hosts: '%s'.",
  "StaleDnsHelper.clusterEndpointDns": "Cluster endpoint resolves to '%s'.",
  "StaleDnsHelper.writerHostInfo": "Writer host: '%s'.",
  "StaleDnsHelper.writerInetAddress": "Writer host address: '%s'",
  "StaleDnsHelper.staleDnsDetected": "Stale DNS data detected. Opening a connection to '%s'.",
  "StaleDnsHelper.reset": "Reset stored writer host.",
  "StaleDnsPlugin.requireDynamicProvider": "Dynamic host list provider is required.",
  "Client.methodNotSupported": "Method '%s' not supported.",
  "Client.invalidTransactionIsolationLevel": "An invalid transaction isolation level was provided: '%s'.",
  "AuroraStaleDnsHelper.clusterEndpointDns": "Cluster endpoint resolves to '%s'.",
  "AuroraStaleDnsHelper.writerHostSpec": "Writer host: '%s'.",
  "AuroraStaleDnsHelper.writerInetAddress": "Writer host address: '%s'",
  "AuroraStaleDnsHelper.staleDnsDetected": "Stale DNS data detected. Opening a connection to '%s'.",
  "ReadWriteSplittingPlugin.setReadOnlyOnClosedClient": "setReadOnly cannot be called on a closed client '%s'.",
  "ReadWriteSplittingPlugin.errorSwitchingToCachedReader":
    "An error occurred while trying to switch to a cached reader client: '%s'. The driver will attempt to establish a new reader client.",
  "ReadWriteSplittingPlugin.errorSwitchingToReader": "An error occurred while trying to switch to a reader client: '%s'.",
  "ReadWriteSplittingPlugin.errorSwitchingToWriter": "An error occurred while trying to switch to a writer client: '%s'.",
  "ReadWriteSplittingPlugin.closingInternalClients": "Closing all internal clients except for the current one.",
  "ReadWriteSplittingPlugin.setReaderClient": "Reader client set to '%s'",
  "ReadWriteSplittingPlugin.setWriterClient": "Writer client set to '%s'",
  "ReadWriteSplittingPlugin.failedToConnectToWriter": "Failed to connect to the writer instance: '%s'",
  "ReadWriteSplittingPlugin.setReadOnlyFalseInTransaction":
    "setReadOnly(false) was called on a read-only client inside a transaction. Please complete the transaction before calling setReadOnly(false).",
  "ReadWriteSplittingPlugin.fallbackToWriter": "Failed to switch to a reader; the current writer will be used as a fallback: '%s'",
  "ReadWriteSplittingPlugin.switchedFromWriterToReader": "Switched from a writer to a reader host. New reader host: '%s'",
  "ReadWriteSplittingPlugin.switchedFromReaderToWriter": "Switched from a reader to a writer host. New writer host: '%s'",
  "ReadWriteSplittingPlugin.settingCurrentClient": "Setting the current client to '%s' - '%s'",
  "ReadWriteSplittingPlugin.noWriterFound": "No writer was found in the current host list.",
  "ReadWriteSplittingPlugin.noReadersFound":
    "A reader instance was requested via setReadOnly, but there are no readers in the host list. The current writer will be used as a fallback: '%s'",
  "ReadWriteSplittingPlugin.emptyHostList": "Host list is empty.",
  "ReadWriteSplittingPlugin.errorWhileExecutingCommand": "[ReadWriteSplitting] Detected an error while executing a command: '%s', '%s'",
  "ReadWriteSplittingPlugin.failoverErrorWhileExecutingCommand": "Detected a failover error while executing a command: '%s'",
  "ReadWriteSplittingPlugin.noReadersAvailable": "The plugin was unable to establish a reader client to any reader instance.",
  "ReadWriteSplittingPlugin.successfullyConnectedToReader": "Successfully connected to a new reader host: '%s'",
  "ReadWriteSplittingPlugin.failedToConnectToReader": "Failed to connect to reader host: '%s'",
  "ReadWriteSplittingPlugin.unsupportedHostSelectorStrategy":
    "Unsupported host selection strategy '%s' specified in plugin configuration parameter 'readerHostSelectorStrategy'. Please visit the Read/Write Splitting Plugin documentation for all supported strategies.",
  "ReadWriteSplittingPlugin.errorVerifyingInitialHostRole":
    "An error occurred while obtaining the connected host's role. This could occur if the client is broken or if you are not connected to an Aurora database.",
  "ReadWriteSplittingPlugin.unavailableHostInfo": "ReadWriteSplittingPlugin.unavailableHostInfo",
  "AdfsCredentialsProviderFactory.failedLogin": "Failed login. Could not obtain SAML Assertion from ADFS SignOn Page POST response: \n '%s'",
  "AdfsCredentialsProviderFactory.invalidHttpsUrl": "Invalid HTTPS URL: '%s'",
  "AdfsCredentialsProviderFactory.signOnPagePostActionUrl": "ADFS SignOn Action URL: '%s'",
  "AdfsCredentialsProviderFactory.signOnPagePostActionRequestFailed":
    "ADFS SignOn Page POST action failed with HTTP status '%s', reason phrase '%s', and response '%s'",
  "AdfsCredentialsProviderFactory.signOnPageRequestFailed":
    "ADFS SignOn Page Request Failed with HTTP status '%s', reason phrase '%s', and response '%s'",
  "AdfsCredentialsProviderFactory.signOnPageUrl": "ADFS SignOn URL: '%s'",
  "Authentication.unsupportedHostname":
    "Unsupported AWS hostname '%s'. Amazon domain name in format *.AWS-Region.rds.amazonaws.com or *.rds.AWS-Region.amazonaws.com.cn is expected.",
  "Authentication.connectError": "Error occurred while opening a connection: %s",
  "Authentication.invalidPort": "Port number: %s is not valid. Port number should be greater than zero. Falling back to default port.",
  "AuthenticationToken.tokenExpirationLessThanZero": "Authentication token expiration time must be a non-negative value.",
  "AuthenticationToken.useCachedToken": "Use cached authentication token = '%s'",
  "AuthenticationToken.generatedNewToken": "Generated new authentication token = '%s'",
  "OktaCredentialsProviderFactory.samlAssertionUrl": "Okta SAML assertion URL: '%s'",
  "OktaCredentialsProviderFactory.sessionTokenRequestFailed":
    "Failed to retrieve session token from Okta, please ensure the provided Okta username, password and endpoint are correct.",
  "OktaCredentialsProviderFactory.invalidSessionToken": "Invalid response from session token request to Okta.",
  "OktaCredentialsProviderFactory.invalidSamlResponse": "The SAML Assertion request did not return a valid response containing a SAMLResponse.",
  "OktaCredentialsProviderFactory.samlRequestFailed":
    "Okta SAML Assertion request failed with HTTP status '%s', reason phrase '%s', and response '%s'",
  "SamlCredentialsProviderFactory.getSamlAssertionFailed": "Failed to get SAML Assertion due to error: '%s'",
  "SamlAuthPlugin.unhandledError": "Unhandled error: '%s'",
  "HostAvailabilityStrategy.invalidMaxRetries":
    "Invalid value of '%s' for configuration parameter `hostAvailabilityStrategyMaxRetries`. It must be an integer greater or equal to 1.",
  "HostAvailabilityStrategy.invalidInitialBackoffTime":
    "Invalid value of '%s'  for configuration parameter `hostAvailabilityStrategyInitialBackoffTime`. It must be an integer greater or equal to 1.",
  "MonitorConnectionContext.errorAbortingConnection": "Error during aborting connection: %s.",
  "MonitorConnectionContext.hostDead": "Host %s is *dead*.",
  "MonitorConnectionContext.hostNotResponding": "Host %s is *not responding*",
  "MonitorConnectionContext.hostAlive": "Host %s is *alive*.",
  "MonitorImpl.contextNullWarning": "Parameter 'context' should not be null or undefined.",
  "MonitorImpl.errorDuringMonitoringContinue": "Continuing monitoring after unhandled error was thrown in monitoring for host %s.",
  "MonitorImpl.errorDuringMonitoringStop": "Stopping monitoring after unhandled error was thrown during monitoring for host %s.",
  "MonitorImpl.monitorIsStopped": "Monitoring was already stopped for host %s.",
  "MonitorImpl.stopped": "Stopped monitoring for host '%s'.",
  "MonitorImpl.startMonitoring": "Start monitoring for %s.",
  "MonitorImpl.stopMonitoring": "Stop monitoring for %s.",
  "MonitorImpl.startMonitoringTaskNewContext": "Start monitoring task for checking new contexts for '%s'",
  "MonitorImpl.stopMonitoringTaskNewContext": "Stop monitoring task for checking new contexts for '%s'",
  "MonitorService.startMonitoringNullMonitor": "Start monitoring called but could not find monitor for host: '%s'.",
  "MonitorService.emptyAliasSet": "Empty alias set passed for '%s'. Set should not be empty.",
  "PluginService.hostListEmpty": "Current host list is empty.",
  "PluginService.releaseResources": "Releasing resources.",
  "PluginService.hostsChangeListEmpty": "There are no changes in the hosts' availability.",
  "PluginService.failedToRetrieveHostPort": "Could not retrieve Host:Port for connection.",
  "PluginService.nonEmptyAliases": "fillAliases called when HostInfo already contains the following aliases: '%s'.",
  "PluginService.forceMonitoringRefreshTimeout": "A timeout error occurred after waiting '%s' ms for refreshed topology.",
  "PluginService.requiredBlockingHostListProvider":
    "The detected host list provider is not a BlockingHostListProvider. A BlockingHostListProvider is required to force refresh the host list. Detected host list provider: '%s'.",
  "PluginService.currentHostNotAllowed": "The current host is not in the list of allowed hosts. Current host: '%s'. Allowed hosts: '%s'.",
  "PluginService.currentHostNotDefined": "The current host is undefined.",
  "MonitoringHostListProvider.requiresMonitor":
    "The MonitoringRdsHostListProvider could not retrieve or initialize a ClusterTopologyMonitor for refreshing the topology.",
  "MonitoringHostListProvider.errorForceRefresh": "The MonitoringRdsHostListProvider could not refresh the topology, caught error: '%s'",
  "HostMonitoringConnectionPlugin.activatedMonitoring": "Executing method '%s', monitoring is activated.",
  "HostMonitoringConnectionPlugin.unableToIdentifyConnection":
    "Unable to identify the given connection: '%s', please ensure the correct host list provider is specified. The host list provider in use is: '%s'.",
  "HostMonitoringConnectionPlugin.errorIdentifyingConnection": "Error occurred while identifying connection: '%s'.",
  "HostMonitoringConnectionPlugin.unavailableHost": "Host '%s' is unavailable.",
  "HostMonitoringConnectionPlugin.identifyClusterConnection":
    "Monitoring host info is associated with a cluster endpoint, plugin needs to identify the cluster connection.",
  "PluginServiceImpl.failedToRetrieveHostPort": "PluginServiceImpl.failedToRetrieveHostPort",
  "AuroraInitialConnectionStrategyPlugin.unsupportedStrategy": "Unsupported host selection strategy '%s'.",
  "AuroraInitialConnectionStrategyPlugin.requireDynamicProvider": "Dynamic host list provider is required.",
  "OpenedConnectionTracker.unableToPopulateOpenedConnectionQueue":
    "The driver is unable to track this opened connection because the instance endpoint is unknown: '%s'",
  "OpenedConnectionTracker.invalidatingConnections": "Invalidating opened connections to host: '%s'",
  "HostSelector.roundRobinInvalidDefaultWeight":
    "The provided default weight value is not valid. Weight values must be an integer greater than or equal to the default weight value of 1.",
  "HostSelector.roundRobinInvalidHostWeightPairs":
    "The provided host weight pairs have not been configured correctly. Please ensure the provided host weight pairs is a comma separated list of pairs, each pair in the format of <host>:<weight>. Weight values must be an integer greater than or equal to the default weight value of 1.",
  "HostSelector.roundRobinMissingClusterInfo": "Could not find a RoundRobinClusterInfo object for the specified host '%s'",
  "RdsMultiAZMySQLDatabaseDialect.invalidQuery":
    "Error obtaining host list: %s. Provided database might not be a Multi-AZ RDS MySQL database cluster.",
  "RdsMultiAZPgDatabaseDialect.invalidQuery":
    "Error obtaining host list: %s. Provided database might not be a Multi-AZ RDS PostgreSQL database cluster.",
  "RdsMultiAzDatabaseDialect.invalidTopology": "Error retrieving a valid topology using the current database dialect: %s",
  "DefaultTelemetryFactory.invalidBackend":
    "%s is not a valid %s backend. Available options for tracing are: OTLP, XRAY, NONE. Available options for metrics are: OTLP, NONE.",
  "DefaultTelemetryFactory.importFailure": "A tracing backend could not be found.",
  "DefaultTelemetryFactory.missingTracingBackend": "A tracing backend could not be found.",
  "DefaultTelemetryFactory.missingMetricsBackend": "A metrics backend could not be found.",
  "InternalPooledConnectionProvider.pooledConnectionFailed": "Internal pooled connection failed with message: '%s'",
  "ErrorHandler.NoOpListener": "[%s] NoOp error event listener caught error: '%s'",
  "ErrorHandler.TrackerListener": "[%s] Tracker error event listener caught error: '%s'",
  "LimitlessConnectionPlugin.unsupportedDialectOrDatabase":
    "Unsupported dialect '%s' encountered. Please ensure connection parameters are correct, and refer to the documentation to ensure that the connecting database is compatible with the Limitless Connection Plugin.",
  "LimitlessRouterMonitor.stopped": "Limitless Router Monitor task stopped on instance '%s'.",
  "LimitlessRouterMonitor.running": "Limitless Router Monitor task running on instance '%s'.",
  "LimitlessRouterMonitor.errorDuringMonitoringStop": "Unhandled error was thrown in Limitless Router Monitoring task for instance '%s'.",
  "LimitlessRouterMonitor.openingConnection": "Opening Limitless Router Monitor connection to '%s'.",
  "LimitlessRouterMonitor.openedConnection": "Opened Limitless Router Monitor connection to '%s'.",
  "LimitlessRouterServiceImpl.nullLimitlessRouterMonitor": "Limitless Router Monitor can't be instantiated.",
  "LimitlessQueryHelper.unsupportedDialectOrDatabase":
    "Unsupported dialect '%s' encountered. Please ensure connection parameters are correct, and refer to the documentation to ensure that the connecting database is compatible with the Limitless Connection Plugin.",
  "LimitlessQueryHelper.invalidRouterLoad":
    "Invalid load metric value of %s from the transaction router query aurora_limitless_router_endpoints() for transaction router '%s'. The load metric value must be a decimal value between 0 and 1. Host weight be assigned a default weight of 1.",
  "LimitlessRouterServiceImpl.limitlessRouterCacheEmpty":
    "Limitless Router cache is empty. This normal during application start up when the cache is not yet populated.",
  "LimitlessRouterServiceImpl.usingProvidedConnectUrl": "Connecting using provided connection URL.",
  "LimitlessRouterServiceImpl.connectWithHost": "Connecting to host '%s'",
  "LimitlessRouterServiceImpl.selectedHost": "Host '%s' has been selected.",
  "LimitlessRouterServiceImpl.failedToConnectToHost": "Failed to connect to host '%s'.",
  "LimitlessRouterServiceImpl.noRoutersAvailableForRetry":
    "No transaction routers available for connection retry. Retrying with original connection.",
  "LimitlessRouterServiceImpl.noRoutersAvailable": "No transaction routers available.",
  "LimitlessRouterServiceImpl.selectedHostForRetry": "Host '%s' has been selected for connection retry.",
  "LimitlessRouterServiceImpl.incorrectConfiguration":
    "Limitless Connection Plugin is unable to run. Please ensure the connection settings are correct.",
  "LimitlessRouterServiceImpl.maxRetriesExceeded": "Max number of connection retries has been exceeded.",
  "LimitlessRouterServiceImpl.synchronouslyGetLimitlessRouters": "Fetching Limitless Routers synchronously.",
  "LimitlessRouterServiceImpl.getLimitlessRoutersError": "Error encountered getting Limitless Routers. %s",
  "LimitlessRouterServiceImpl.fetchedEmptyRouterList": "Empty router list was fetched.",
  "LimitlessRouterServiceImpl.errorStartingMonitor": "An error occurred while starting Limitless Router Monitor. %s",
  "AwsCredentialsManager.wrongHandler": "Provided AWS credential provider handler should implement AwsCredentialsProviderHandler.",
  "HostResponseTimeMonitor.stopped": "Host Response Time Monitor task stopped on instance '%s'.",
  "HostResponseTimeMonitor.responseTime": "Response time for '%s': '%s' ms.",
  "HostResponseTimeMonitor.interruptedErrorDuringMonitoring": "Response time task for host '%s' was interrupted.",
  "HostResponseTimeMonitor.openingConnection": "Opening a Response time connection to '%s'.",
  "HostResponseTimeMonitor.openedConnection": "Opened Response time connection: '%s'.",
  "FastestResponseStrategyPlugin.unsupportedHostSelectorStrategy":
    "Unsupported host selector strategy: '%s'. To use the fastest response strategy plugin, please ensure the property 'readerHostSelectorStrategy' is set to 'fastestResponse'.",
  "ConfigurationProfileBuilder.notFound": "Configuration profile '%s' not found.",
  "ConfigurationProfileBuilder.profileNameRequired": "Profile name is required.",
  "ConfigurationProfileBuilder.canNotUpdateKnownPreset": "Can't add or update a built-in preset configuration profile '%s'.",
  "AwsClient.configurationProfileNotFound": "Configuration profile '%s' not found.",
  "AwsClient.targetClientNotDefined": "AwsClient targetClient not defined.",
  "Failover2.failoverReaderNotConnectedToReader": "Unable to establish SQL connection to the instance '%s' as a reader.",
  "Failover2.failoverWriterConnectedToReader": "The new writer was identified to be '%s', but querying the instance for its role returned a reader.",
  "Failover2.unableToFetchTopology": "Unable to establish SQL connection and fetch topology.",
  "Failover2.errorSelectingReaderHost": "An error occurred while attempting to select a reader host candidate: '%s'.",
  "Failover2.readerCandidateNull": "Reader candidate unable to be selected.",
  "Failover2.strictReaderUnknownHostRole": "Unknown host role of reader candidate in strict reader failoverMode.",
  "ClusterTopologyMonitor.timeoutError": "ClusterTopologyMonitor topology update timed out in '%s' ms.",
  "ClusterTopologyMonitor.errorFetchingTopology": "[ClusterTopologyMonitor] Error fetching topology: '%s'.",
  "ClusterTopologyMonitoring.ignoringNewTopologyRequest": "Previous failover has just completed, ignoring new topology request.",
  "ClusterTopologyMonitoring.timeoutSetToZero":
    "A topology refresh was requested, but the given timeout for the request was 0 ms. Returning cached hosts: ",
  "ClusterTopologyMonitor.startingHostMonitors": "Starting host monitoring tasks.",
  "ClusterTopologyMonitor.writerPickedUpFromHostMonitors":
    "The writer host detected by the host monitors was picked up by the topology monitor: '%s'.",
  "ClusterTopologyMonitor.writerMonitoringConnection": "The monitoring connection is connected to a writer: '%s'.",
  "ClusterTopologyMonitor.invalidWriterQuery":
    "An error occurred while attempting to obtain the writer id because the query was invalid. Please ensure you are connecting to an Aurora or RDS DB cluster. Error: '%s'",
  "ClusterTopologyMonitor.unableToConnect": "Could not connect to initial host: '%s'.",
  "ClusterTopologyMonitor.openedMonitoringConnection": "Opened monitoring connection to: '%s'.",
  "ClusterTopologyMonitor.startMonitoring": "Start cluster monitoring task.",
  "ClusterTopologyMonitor.errorDuringMonitoring": "Error thrown during cluster topology monitoring: '%s'.",
  "ClusterTopologyMonitor.endMonitoring": "Stop cluster topology monitoring.",
  "HostMonitor.startMonitoring": "Host monitor '%s' started.",
  "HostMonitor.detectedWriter": "Detected writer: '%s' - '%s'.",
  "HostMonitor.endMonitoring": "Host monitor '%s' completed in '%s'.",
  "HostMonitor.writerHostChanged": "Writer host has changed from '%s' to '%s'.",
  "HostMonitor.writerIsStale": "Connected writer instance '%s' is stale.",
  "SlidingExpirationCacheWithCleanupTask.cleaningUp": "Cleanup interval of '%s' minutes has passed, cleaning up sliding expiration cache '%s'.",
  "SlidingExpirationCacheWithCleanupTask.cleanUpTaskInterrupted": "Sliding expiration cache '%s' cleanup task has been interrupted and is exiting.",
  "SlidingExpirationCacheWithCleanupTask.cleanUpTaskStopped": "Sliding expiration cache '%s' cleanup task has been stopped and is exiting.",
  "SlidingExpirationCacheWithCleanupTask.clear": "Sliding expiration cache '%s' has been cleared, all resources are released.",
  "SlidingExpirationCacheWithCleanupTask.cleanUpTaskInitialized": "Sliding expiration cache '%s' cleanup task has been initialized.",
  "HostMonitoringConnectionPlugin.monitoringDeactivated": "Monitoring deactivated for method '%s'.",
  "CustomEndpointPlugin.connectionRequestToCustomEndpoint": "Detected a connection request to a custom endpoint URL: '%s'.",
  "CustomEndpointPlugin.errorParsingEndpointIdentifier": "Unable to parse custom endpoint identifier from URL: '%s'.",
  "CustomEndpointPlugin.unableToDetermineRegion":
    "Unable to determine connection region. If you are using a non-standard RDS URL, please set the '%s' property.",
  "CustomEndpointPlugin.waitingForCustomEndpointInfo":
    "Custom endpoint info for '%s' was not found. Waiting '%s' ms for the endpoint monitor to fetch info...",
  "CustomEndpointPlugin.closeMonitors":
    "Closing custom endpoint monitors. Active custom endpoint monitors will be stopped, closed, and removed from the monitor's cache.",
  "CustomEndpointPlugin.timedOutWaitingForCustomEndpointInfo":
    "The custom endpoint plugin timed out after '%s' ms while waiting for custom endpoint info for host '%s'.",
  "CustomEndpointMonitorImpl.startingMonitor": "Starting custom endpoint monitor for '%s'.",
  "CustomEndpointMonitorImpl.unexpectedNumberOfEndpoints":
    "Unexpected number of custom endpoints with endpoint identifier '%s' in region '%s'. Expected 1, but found '%s'. Endpoints:\n'%s'.",
  "CustomEndpointMonitorImpl.detectedChangeInCustomEndpointInfo": "Detected change in custom endpoint info for '%s': %s",
  "CustomEndpointMonitorImpl.error": "Encountered an error while monitoring custom endpoint '%s': '%s'",
  "CustomEndpointMonitorImpl.stoppedMonitor": "Stopped custom endpoint monitor for '%s'.",
  "CustomEndpointMonitorImpl.stoppingMonitor": "Stopping custom endpoint monitor for '%s'.",
  "CustomEndpointMonitorImpl.noEndpoints":
    "Unable to find any custom endpoints. When connecting with a custom endpoint, at least one custom endpoint should be detected.",
  "AwsSdk.unsupportedRegion":
    "Unsupported AWS region '%s'. For supported regions please read https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html",
  "Bgd.inProgressConnectionClosed": "Connection has been closed since Blue/Green switchover is in progress.",
  "Bgd.inProgressSuspendConnect":
    "Blue/Green Deployment switchover is in progress. The  'connect' call will be delayed until switchover is completed.",
  "Bgd.inProgressTryConnectLater": "Blue/Green Deployment switchover is still in progress after %s ms. Try to connect again later.",
  "Bgd.switchoverCompleteContinueWithConnect":
    "Blue/Green Deployment switchover is completed. Continue with connect call. The call was suspended for %s ms.",
  "Bgd.inProgressSuspendMethod": "Blue/Green Deployment switchover is in progress. Suspend '%s' call until switchover is completed.",
  "Bgd.stillInProgressTryMethodLater": "Blue/Green Deployment switchover is still in progress after %s ms. Try '%s' again later.",
  "Bgd.switchoverCompletedContinueWithMethod":
    "Blue/Green Deployment switchover is completed. Continue with '%s' call. The call was suspended for %s ms.",
  "Bgd.inProgressCantConnect": "Blue/Green Deployment switchover is in progress. New connection can't be opened.",
  "Bgd.requireIamHost": "Connecting with IP address when IAM authentication is enabled requires an 'iamHost' parameter.",
  "Bgd.inProgressCantOpenConnection": "Blue/Green Deployment switchover is in progress. Can''t establish connection to '%s'.",
  "Bgd.unknownRole": "Unknown blue/green role '%s'.",
  "Bgd.unknownVersion": "Unknown blue/green version '%s'.",
  "Bgd.unknownStatus": "Unknown blue/green status '%s'.",
  "Bgd.statusChanged": "[%s] Status changed to: %s",
  "Bgd.interrupted": "[%s] Interrupted.",
  "Bgd.monitoringUnhandledError": "[%s] Unhandled exception while monitoring blue/green status: %s",
  "Bgd.monitoringCompleted": "[%s] Blue/green status monitoring loop is completed.",
  "Bgd.statusNotAvailable": "[%s] (status not available) currentPhase: %s.",
  "Bgd.usesVersion": "[%s] Blue/Green deployment uses version '%s' which the driver doesn't support. Version '%s' will be used instead.",
  "Bgd.noEntriesInStatusTable": "[%s] No entries in status table.",
  "Bgd.error": "[%s] currentPhase: %s, error while querying for blue/green status: %s.",
  "Bgd.unhandledNetworkError": "[%s] Unhandled network error: %s.",
  "Bgd.unhandledError": "[%s] Unhandled error: %s.",
  "Bgd.openingConnectionWithIp": "[%s] Opening monitoring connection (IP) to %s.",
  "Bgd.openedConnectionWithIp": "[%s] Opened monitoring connection (IP) to %s.",
  "Bgd.openingConnection": "[%s] Opening monitoring connection to %s.",
  "Bgd.openedConnection": "[%s] Opened monitoring connection to %s.",
  "Bgd.createHostListProvider": "[%s] Creating a new HostListProvider, clusterId: %s.",
  "Bgd.unsupportedDialect": "[bgdId: '%s'] Blue/Green Deployments aren't supported by the current database dialect: %s.",
  "Bgd.interimStatus": "[bgdId: '%s', role: %s] %s",
  "Bgd.rollback": "[bgdId: '%s'] Blue/Green deployment is in rollback mode.",
  "Bgd.unknownPhase": "[bgdId: '%s'] Unknown BG phase '%s'.",
  "Bgd.blueDnsCompleted": "[bgdId: '%s'] Blue DNS update completed.",
  "Bgd.greenDnsRemoved": "[bgdId: '%s'] Green DNS removed.",
  "Bgd.greenTopologyChanged": "[bgdId: '%s'] Green topology changed.",
  "Bgd.switchoverTimeout": "Blue/Green switchover has timed out.",
  "Bgd.greenHostChangedName": "Green host '%s' has changed names, using IAM host '%s'.",
  "Bgd.resetContext": "Blue Green Status Provider resetting context.",
  "Bgd.hostInfoNull": "Unable to initialize HostListProvider since connection host information is null.",
  "Bgd.waitConnectUntilCorrespondingHostFound":
    "Blue/Green Deployment switchover is in progress and a corresponding host for '%s' is not found. The 'connect' call will be delayed.",
  "Bgd.correspondingHostNotFoundTryConnectLater":
    "Blue/Green Deployment switchover is still in progress and a corresponding host for '%s' is not found after %s ms. Try to connect again later.",
  "Bgd.correspondingHostFoundContinueWithConnect":
    "A corresponding host for '%s' is found. Continue with connect call. The call was suspended for %s ms.",
  "Bgd.completedContinueWithConnect": "Blue/Green Deployment status is completed. Continue with 'connect' call. The call was suspended for %s ms.",
  "StorageService.itemClassNotRegistered": "[StorageService] Item class not registered: %s",
  "StorageService.unexpectedValueMismatch": "[StorageService] Unexpected value mismatch for %s: %s",
  "TopologyUtils.instanceIdRequired": "InstanceId must not be en empty string."
};

export class Messages {
  static get(key: string, ...val: string[]) {
    let message = MESSAGES[key] || key;
    val.forEach((value) => {
      message = message.replace(/%s/, value);
    });
    return message;
  }
}
