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

import { Messages } from "./messages";

export class AwsWrapperError extends Error {
  constructor(message?: string, cause?: any) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

export class UndefinedClientError extends AwsWrapperError {
  constructor() {
    super(Messages.get("Client.undefinedTargetClient"));
  }
}

export class UnsupportedStrategyError extends AwsWrapperError {}

export class UnsupportedMethodError extends AwsWrapperError {}

export class IllegalArgumentError extends AwsWrapperError {}

export class FailoverError extends AwsWrapperError {}

export class FailoverSuccessError extends FailoverError {
  constructor(message?: string, cause?: any) {
    super(message ?? Messages.get("Failover.connectionChangedError"), cause);
  }
}

export class FailoverFailedError extends FailoverError {}

export class TransactionResolutionUnknownError extends FailoverError {}

export class ReadWriteSplittingError extends AwsWrapperError {}

export class LoginError extends AwsWrapperError {}

export class AwsTimeoutError extends AwsWrapperError {}

export class InternalQueryTimeoutError extends AwsTimeoutError {}

export class UnavailableHostError extends AwsWrapperError {}

/**
 * The connection reached its configured maximum lifetime and was closed. The client cannot be used again.
 */
export class ConnectionLifetimeError extends AwsWrapperError {
  constructor(cause?: any) {
    super(Messages.get("ConnectionLifetimeError.connectionClosed"), cause);
  }
}

/**
 * The connection reached its configured maximum lifetime and a replacement connection could not be established.
 * The original error is available as `cause`.
 */
export class ConnectionLifetimeFailedError extends AwsWrapperError {
  constructor(cause?: any) {
    super(Messages.get("ConnectionLifetimeFailedError.unableToReconnect"), cause);
  }
}

/**
 * The connection reached its configured maximum lifetime and was replaced with a new connection. The pending call
 * was not executed. It extends `FailoverSuccessError` so that applications that already retry after a successful
 * failover also retry here.
 */
export class ConnectionLifetimeSuccessError extends FailoverSuccessError {
  constructor(cause?: any) {
    super(Messages.get("ConnectionLifetimeSuccessError.connectionChanged"), cause);
  }
}
