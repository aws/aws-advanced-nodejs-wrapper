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

import { createLogger, transports, format } from "winston";
import dotenv from "dotenv";

const { combine, timestamp, printf, colorize } = format;

dotenv.config();

const logLevel = process.env.LOG_LEVEL;

export function uniqueId(prefix: string): string {
  return `${prefix}${Math.random().toString(16).slice(2)}`;
}

class AwsWrapperLogger {
  private static readonly logger = createLogger({
    format: combine(
      colorize(),
      timestamp(),
      printf((info) => {
        return `${info.timestamp} [${info.level}]: ${info.message}`;
      })
    ),
    transports: [new transports.Console()],
    level: logLevel ? logLevel : "warn"
  });

  get level() {
    return AwsWrapperLogger.logger.level;
  }

  log(logLevel: string, message: string) {
    AwsWrapperLogger.logger.log(logLevel, message);
  }

  error(message: string) {
    if (AwsWrapperLogger.logger.level === "error") {
      AwsWrapperLogger.logger.error(message);
    }
  }

  warn(message: string) {
    if (AwsWrapperLogger.logger.level === "warn") {
      AwsWrapperLogger.logger.warn(message);
    }
  }

  info(message: string) {
    if (AwsWrapperLogger.logger.level === "info") {
      AwsWrapperLogger.logger.info(message);
    }
  }

  verbose(message: string) {
    if (AwsWrapperLogger.logger.level === "verbose") {
      AwsWrapperLogger.logger.verbose(message);
    }
  }

  debug(message: string) {
    if (AwsWrapperLogger.logger.level === "debug") {
      AwsWrapperLogger.logger.debug(message);
    }
  }

  silly(message: string) {
    if (AwsWrapperLogger.logger.level === "silly") {
      AwsWrapperLogger.logger.silly(message);
    }
  }

  warning(message: string) {
    AwsWrapperLogger.logger.warning(message);
  }
}

export const logger = new AwsWrapperLogger();
