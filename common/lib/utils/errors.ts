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

export class UnsupportedStrategyError extends AwsWrapperError {}

export class UnsupportedMethodError extends AwsWrapperError {}

export class IllegalArgumentError extends AwsWrapperError {}

export class FailoverError extends AwsWrapperError {}

export class FailoverSuccessError extends FailoverError {
  constructor(message?: string, cause?: any) {
    super(Messages.get("Failover.connectionChangedError"));
  }
}

export class FailoverFailedError extends FailoverError {}

export class TransactionResolutionUnknownError extends FailoverError {}

export class LoginError extends AwsWrapperError {}

export class InternalQueryTimeoutError extends AwsWrapperError {}

export class UnavailableHostError extends AwsWrapperError {}
