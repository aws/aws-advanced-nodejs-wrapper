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

import { DatabaseDialectProvider } from "./database_dialect_provider";
import { DatabaseDialect, DatabaseType } from "./database_dialect";
import { DatabaseDialectCodes } from "./database_dialect_codes";
import { WrapperProperties } from "../wrapper_property";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";
import { RdsUtils } from "../utils/rds_utils";
import { logger } from "../../logutils";
import { CacheMap } from "../utils/cache_map";
import { ClientWrapper } from "../client_wrapper";

export class DatabaseDialectManager implements DatabaseDialectProvider {
  /**
   * In order to simplify dialect detection, there's an internal host-to-dialect cache.
   * The cache contains host endpoints and identified dialect. Cache expiration time in
   * milliseconds is defined by the variable below.
   */
  private static readonly ENDPOINT_CACHE_EXPIRATION_MS = 86_400_000_000_000; // 24 hours
  protected static readonly knownEndpointDialects: CacheMap<string, string> = new CacheMap();
  protected readonly knownDialectsByCode: Map<string, DatabaseDialect>;

  private static customDialect: DatabaseDialect | null = null;
  private readonly rdsHelper: RdsUtils = new RdsUtils();
  private readonly dbType;
  private canUpdate: boolean = false;
  private dialect: DatabaseDialect;
  private dialectCode: string = "";

  constructor(knownDialectsByCode: any, dbType: DatabaseType, props: Map<string, any>) {
    this.knownDialectsByCode = knownDialectsByCode;
    this.dbType = dbType;
    this.dialect = this.getDialect(props);
  }

  static setCustomDialect(dialect: DatabaseDialect) {
    DatabaseDialectManager.customDialect = dialect;
  }

  static resetCustomDialect() {
    DatabaseDialectManager.customDialect = null;
  }

  static resetEndpointCache() {
    DatabaseDialectManager.knownEndpointDialects.clear();
  }

  getDialect(props: Map<string, any>): DatabaseDialect {
    if (this.dialect) {
      return this.dialect;
    }

    this.canUpdate = false;

    if (DatabaseDialectManager.customDialect) {
      this.dialectCode = DatabaseDialectCodes.CUSTOM;
      this.dialect = DatabaseDialectManager.customDialect;
      this.logCurrentDialect();
      return this.dialect;
    }

    const userDialectSetting = WrapperProperties.DIALECT.get(props);
    const host = props.get(WrapperProperties.HOST.name);
    const dialectCode = userDialectSetting ?? DatabaseDialectManager.knownEndpointDialects.get(host);

    if (dialectCode) {
      const userDialect = this.knownDialectsByCode.get(dialectCode);
      if (userDialect) {
        this.dialectCode = dialectCode;
        this.dialect = userDialect;
        this.logCurrentDialect();
        return userDialect;
      }
      throw new AwsWrapperError(Messages.get("DialectManager.unknownDialectCode", dialectCode));
    }

    if (this.dbType === DatabaseType.MYSQL) {
      const type = this.rdsHelper.identifyRdsType(host);
      if (type.isRdsCluster) {
        this.dialectCode = DatabaseDialectCodes.AURORA_MYSQL;
        this.dialect = <DatabaseDialect>this.knownDialectsByCode.get(DatabaseDialectCodes.AURORA_MYSQL);
        this.logCurrentDialect();
        return this.dialect;
      }

      if (type.isRds) {
        this.canUpdate = true;
        this.dialectCode = DatabaseDialectCodes.RDS_MYSQL;
        this.dialect = <DatabaseDialect>this.knownDialectsByCode.get(DatabaseDialectCodes.RDS_MYSQL);
        this.logCurrentDialect();
        return this.dialect;
      }

      this.canUpdate = true;
      this.dialectCode = DatabaseDialectCodes.MYSQL;
      this.dialect = <DatabaseDialect>this.knownDialectsByCode.get(DatabaseDialectCodes.MYSQL);
      this.logCurrentDialect();
      return this.dialect;
    }

    if (this.dbType === DatabaseType.POSTGRES) {
      const type = this.rdsHelper.identifyRdsType(host);
      if (type.isRdsCluster) {
        this.dialectCode = DatabaseDialectCodes.AURORA_PG;
        this.dialect = <DatabaseDialect>this.knownDialectsByCode.get(DatabaseDialectCodes.AURORA_PG);
        this.logCurrentDialect();
        return this.dialect;
      }

      if (type.isRds) {
        this.canUpdate = true;
        this.dialectCode = DatabaseDialectCodes.RDS_PG;
        this.dialect = <DatabaseDialect>this.knownDialectsByCode.get(DatabaseDialectCodes.RDS_PG);
        this.logCurrentDialect();
        return this.dialect;
      }

      this.canUpdate = true;
      this.dialectCode = DatabaseDialectCodes.PG;
      this.dialect = <DatabaseDialect>this.knownDialectsByCode.get(DatabaseDialectCodes.PG);
      this.logCurrentDialect();
      return this.dialect;
    }

    throw new AwsWrapperError(Messages.get("DialectManager.getDialectError"));
  }

  async getDialectForUpdate(targetClient: ClientWrapper, originalHost: string, newHost: string): Promise<DatabaseDialect> {
    if (!this.canUpdate) {
      return this.dialect;
    }

    const dialectCandidates = this.dialect.getDialectUpdateCandidates();
    if (dialectCandidates.length > 0) {
      for (const dialectCandidateCode of dialectCandidates) {
        const dialectCandidate = this.knownDialectsByCode.get(dialectCandidateCode);
        if (!dialectCandidate) {
          throw new AwsWrapperError(Messages.get("DialectManager.unknownDialectCode", dialectCandidateCode));
        }

        const isDialect = await dialectCandidate.isDialect(targetClient);
        if (isDialect) {
          this.canUpdate = false;
          this.dialectCode = dialectCandidateCode;
          this.dialect = dialectCandidate;

          DatabaseDialectManager.knownEndpointDialects.put(originalHost, dialectCandidateCode, DatabaseDialectManager.ENDPOINT_CACHE_EXPIRATION_MS);
          DatabaseDialectManager.knownEndpointDialects.put(newHost, dialectCandidateCode, DatabaseDialectManager.ENDPOINT_CACHE_EXPIRATION_MS);

          this.logCurrentDialect();
          return this.dialect;
        }
      }
    }

    DatabaseDialectManager.knownEndpointDialects.put(originalHost, this.dialectCode, DatabaseDialectManager.ENDPOINT_CACHE_EXPIRATION_MS);
    DatabaseDialectManager.knownEndpointDialects.put(newHost, this.dialectCode, DatabaseDialectManager.ENDPOINT_CACHE_EXPIRATION_MS);

    this.logCurrentDialect();
    return this.dialect;
  }

  logCurrentDialect() {
    logger.info(`Current dialect: ${this.dialectCode}, ${this.dialect.getDialectName()}, canUpdate: ${this.canUpdate}`);
  }
}
