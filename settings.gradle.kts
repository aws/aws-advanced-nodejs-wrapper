rootProject.name = "aws-advanced-nodejs-wrapper"

include("integration-testing")

project(":integration-testing").projectDir = file("tests/integration/host")
