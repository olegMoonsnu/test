#!/usr/bin/env bash
set -euo pipefail
: "${GROOVY_JAR:?Set GROOVY_JAR to the path of groovy-all-2.4.21.jar}"
classes=$(mktemp -d)
trap 'rm -rf "$classes"' EXIT
java -cp "$GROOVY_JAR" org.codehaus.groovy.tools.FileSystemCompiler -d "$classes" groovy/integration/AnalyticsPayload.groovy
java -cp "$classes:$GROOVY_JAR" groovy.ui.GroovyMain groovy/examples/PrepareOperation.groovy
java -cp "$classes:$GROOVY_JAR" groovy.ui.GroovyMain tests/ProjectionTest.groovy
