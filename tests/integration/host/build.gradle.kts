import org.gradle.api.tasks.testing.logging.TestExceptionFormat.*
import org.gradle.api.tasks.testing.logging.TestLogEvent.*

plugins {
    id("java")
}

group = "software.amazon.nodejs.integration.tests"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("org.checkerframework:checker-qual:3.26.0")
    testImplementation("org.junit.platform:junit-platform-commons:1.11.3")
    testImplementation("org.junit.platform:junit-platform-engine:1.11.3")
    testImplementation("org.junit.platform:junit-platform-launcher:1.11.3")
    testImplementation("org.junit.platform:junit-platform-suite-engine:1.11.3")
    testImplementation("org.junit.jupiter:junit-jupiter-api:5.11.3")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.11.3")
    testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine")

    testImplementation("org.apache.commons:commons-dbcp2:2.12.0")
    testImplementation("org.postgresql:postgresql:42.7.4")
    testImplementation("com.mysql:mysql-connector-j:9.1.0")
    testImplementation("org.mockito:mockito-inline:4.11.0") // 4.11.0 is the last version compatible with Java 8
    testImplementation("software.amazon.awssdk:ec2:2.29.34")
    testImplementation("software.amazon.awssdk:rds:2.29.34")
    testImplementation("software.amazon.awssdk:sts:2.29.34")

    // Note: all org.testcontainers dependencies should have the same version
    testImplementation("org.testcontainers:testcontainers:1.20.4")
    testImplementation("org.testcontainers:mysql:1.20.4")
    testImplementation("org.testcontainers:postgresql:1.20.4")
    testImplementation("org.testcontainers:mariadb:1.20.4")
    testImplementation("org.testcontainers:junit-jupiter:1.20.4")
    testImplementation("org.testcontainers:toxiproxy:1.20.4")
    testImplementation("org.apache.poi:poi-ooxml:5.3.0")
    testImplementation("org.slf4j:slf4j-simple:2.0.13")
    testImplementation("com.fasterxml.jackson.core:jackson-databind:2.17.1")
    testImplementation("com.amazonaws:aws-xray-recorder-sdk-core:2.18.2")
    testImplementation("io.opentelemetry:opentelemetry-sdk:1.44.1")
    testImplementation("io.opentelemetry:opentelemetry-sdk-metrics:1.44.1")
    testImplementation("io.opentelemetry:opentelemetry-exporter-otlp:1.44.1")
    testImplementation("de.vandermeer:asciitable:0.3.2")
}

tasks.test {
    filter.excludeTestsMatching("integration.*")
}

tasks.withType<Test> {
    useJUnitPlatform()
    outputs.upToDateWhen { false }
    testLogging {
        events(PASSED, FAILED, SKIPPED)
        showStandardStreams = true
        exceptionFormat = FULL
        showExceptions = true
        showCauses = true
        showStackTraces = true
    }

    reports.junitXml.required.set(true)
    reports.html.required.set(false)
}

tasks.register<Test>("test-all-environments") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-performance", "true")
    }
}

tasks.register<Test>("test-docker") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az", "true")
    }
}

tasks.register<Test>("test-aurora") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
    }
}

tasks.register<Test>("test-aurora-postgres") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}


tasks.register<Test>("test-aurora-mysql") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("test-all-aurora-performance") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
    }
}

tasks.register<Test>("test-aurora-pg-performance") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("test-aurora-mysql-performance") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}


tasks.register<Test>("test-multi-az-postgres") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("test-multi-az-mysql") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("test-autoscaling") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
        systemProperty("test-autoscaling", "true")
    }
}

tasks.register<Test>("test-autoscaling-mysql") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("test-autoscaling", "true")
    }
}

tasks.register<Test>("test-autoscaling-postgres") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("test-autoscaling", "true")
    }
}

tasks.register<Test>("test-bgd-mysql-aurora") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
    }
}

tasks.register<Test>("test-bgd-mysql-multiaz") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "false")
    }
}

tasks.register<Test>("test-bgd-pg-aurora") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
    }
}

tasks.register<Test>("test-bgd-pg-multiaz") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.runTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "false")
    }
}

// Debug

tasks.register<Test>("debug-all-environments") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-performance", "true")
    }
}

tasks.register<Test>("debug-docker") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-aurora") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-aurora-pg") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-aurora-mysql") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-aurora-pg-performance") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-aurora-mysql-performance") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-multi-az-mysql") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-multi-az-postgres") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-mysql-driver", "true")
        systemProperty("exclude-mysql-engine", "true")
        systemProperty("exclude-aurora", "true")
        systemProperty("exclude-bg", "true")
    }
}

tasks.register<Test>("debug-autoscaling") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
        systemProperty("exclude-bg", "true")
        systemProperty("test-autoscaling", "true")
    }
}

tasks.register<Test>("debug-bgd-mysql-aurora") {
    group = "verification"
    filter.includeTestsMatching("integration.host.TestRunner.debugTests")
    doFirst {
        systemProperty("exclude-docker", "true")
        systemProperty("exclude-pg-driver", "true")
        systemProperty("exclude-pg-engine", "true")
        systemProperty("exclude-performance", "true")
        systemProperty("exclude-multi-az-cluster", "true")
        systemProperty("exclude-multi-az-instance", "true")
    }
}

