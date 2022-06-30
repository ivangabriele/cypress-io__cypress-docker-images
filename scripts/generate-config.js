const path = require("path")
const fs = require("fs")
const { camelCase } = require("lodash")
const os = require("os")

const imageType = process.argv[2]
const versionTag = process.argv[3]

if (!imageType) {
  console.error("expected an image type like included")
  process.exit(1)
}

if (!versionTag) {
  console.error("expected Cypress version argument like 3.8.3")
  process.exit(1)
}

const awsCodeBuildPreamble = `version: 0.2
env:
    variables:
        PUBLIC_ECR_ALIAS: "cypress-io"

batch:
    fast-fail: false
    build-list:`

const awsCodeBuildPostamble = `phases:
    pre_build:
        commands:
            - aws --version
            - echo Check if $IMAGE_TAG is in ECR...
            - ./find-ecr-image.sh $IMAGE_REPO_NAME $IMAGE_TAG -p
            - echo Logging in to Amazon ECR...
            - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
            - aws ecr-public get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin public.ecr.aws/$PUBLIC_ECR_ALIAS
    build:
        commands:
            - echo Building the Docker image...
            - cd $IMAGE_DIR/$IMAGE_TAG
            - docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .
            - docker tag $IMAGE_REPO_NAME:$IMAGE_TAG public.ecr.aws/$PUBLIC_ECR_ALIAS/$IMAGE_REPO_NAME:$IMAGE_TAG
    post_build:
        commands:
            - echo Pushing the Docker image...
            - docker push public.ecr.aws/$PUBLIC_ECR_ALIAS/$IMAGE_REPO_NAME:$IMAGE_TAG
`

const preamble = `
# WARNING: this file is automatically generated by ${path.basename(__filename)}
# info on building Docker images on Circle
# https://circleci.com/docs/2.0/building-docker-images/
version: 2.1

orbs:
    node: circleci/node@5.0.0

commands:
    halt-on-branch:
        description: Halt current CircleCI job if not on master branch
        steps:
            - run:
                    name: Halting job if not on master branch
                    command: |
                        if [[ "$CIRCLE_BRANCH" != "master" ]]; then
                          echo "Not master branch, will skip the rest of commands"
                          circleci-agent step halt
                        else
                          echo "On master branch, can continue"
                        fi

    halt-if-docker-image-exists:
        description: Halt current CircleCI job if Docker image exists already
        parameters:
            imageName:
                type: string
                description: Docker image name to test
        steps:
            - run:
                  name: Check if image << parameters.imageName >> exists or Docker hub does not respond
                  # using https://github.com/cypress-io/docker-image-not-found
                  # to check if Docker hub definitely does not have this image
                  command: |
                      if npx docker-image-not-found --repo << parameters.imageName >>; then
                        echo Docker hub says image << parameters.imageName >> does not exist
                      else
                        echo Docker hub has image << parameters.imageName >> or not responding
                        echo We should stop in this case
                        circleci-agent step halt
                      fi

    test-base-image:
        description: Build a test image from base image and test it
        parameters:
            nodeVersion:
                type: string
                description: Node version to expect in the base image, starts with "v"
            imageName:
                type: string
                description: Cypress base docker image to test
        steps:
            - run:
                  name: test image << parameters.imageName >> using Kitchensink
                  no_output_timeout: '3m'
                  working_directory: '~/project/test-project'
                  command: |
                      node --version
                      npm i cypress@latest
                      echo "Testing using Electron browser"
                      docker run -it -v $PWD:/e2e -w /e2e << parameters.imageName >> sh -c "./node_modules/.bin/cypress install && ./node_modules/.bin/cypress run"

    test-browser-image:
        description: Build a test image from browser image and test it
        parameters:
            imageName:
                type: string
                description: Cypress browser docker image to test
            chromeVersion:
                type: string
                default: ''
                description: Chrome version to expect in the base image, starts with "Google Chrome XX"
            firefoxVersion:
                type: string
                default: ''
                description: Firefox version to expect in the base image, starts with "Mozilla Firefox XX"
            edgeVersion:
                type: string
                default: ''
                description: Edge version to expect in the base image, starts with "Microsoft Edge"
        steps:
            - when:
                  condition: << parameters.chromeVersion >>
                  steps:
                      - run:
                            name: confirm image has Chrome << parameters.chromeVersion >>
                            # do not run Docker in the interactive mode - adds control characters!
                            # and use Bash regex string comparison
                            command: |
                                version=$(docker run << parameters.imageName >> google-chrome --version)
                                if [[ "$version" =~ ^"<< parameters.chromeVersion >>" ]]; then
                                  echo "Image has the expected version of Chrome << parameters.chromeVersion >>"
                                  echo "found $version"
                                else
                                  echo "Problem: image has unexpected Chrome version"
                                  echo "Expected << parameters.chromeVersion >> and got $version"
                                  exit 1
                                fi

            - when:
                  condition: << parameters.firefoxVersion >>
                  steps:
                      - run:
                            name: confirm the image has Firefox << parameters.firefoxVersion >>
                            command: |
                                version=$(docker run << parameters.imageName >> firefox --version)
                                if [[ "$version" =~ ^"<< parameters.firefoxVersion >>" ]]; then
                                  echo "Image has the expected version of Firefox << parameters.firefoxVersion >>"
                                  echo "found $version"
                                else
                                  echo "Problem: image has unexpected Firefox version"
                                  echo "Expected << parameters.firefoxVersion >> and got $version"
                                  exit 1
                                fi

            - when:
                  condition: << parameters.edgeVersion >>
                  steps:
                      - run:
                            name: confirm the image has Edge << parameters.edgeVersion >>
                            command: |
                                version=$(docker run << parameters.imageName >> edge --version)
                                if [[ "$version" ]]; then
                                  echo "Image has the a version of Edge << parameters.edgeVersion >>"
                                  echo "found $version"
                                else
                                  echo "Problem: image has no Edge version"
                                  echo "Expected to have $version"
                                  exit 1
                                fi

            - run:
                  name: Install deps for image << parameters.imageName >>
                  no_output_timeout: "3m"
                  working_directory: "~/project/test-project"
                  command: |
                    node --version
                    npm i cypress@latest
                    echo "Installing Cypress"
                    docker run -it -v $PWD:/e2e -w /e2e << parameters.imageName >> sh -c "./node_modules/.bin/cypress install

            - run:
                  name: Test built-in Electron browser
                  no_output_timeout: '1m'
                  command: docker run cypress/test ./node_modules/.bin/cypress run

            - when:
                  condition: << parameters.chromeVersion >>
                  steps:
                      - run:
                            name: Test << parameters.chromeVersion >>
                            no_output_timeout: '1m'
                            command: docker run cypress/test ./node_modules/.bin/cypress run --browser chrome

            - when:
                  condition: << parameters.firefoxVersion >>
                  steps:
                      - run:
                            name: Test << parameters.firefoxVersion >>
                            no_output_timeout: '1m'
                            command: docker run cypress/test ./node_modules/.bin/cypress run --browser firefox

            - when:
                  condition: << parameters.edgeVersion >>
                  steps:
                      - run:
                            name: Test << parameters.edgeVersion >>
                            no_output_timeout: '1m'
                            command: docker run cypress/test ./node_modules/.bin/cypress run --browser edge

            - run:
                  name: scaffold image << parameters.imageName >> using Kitchensink
                  no_output_timeout: '3m'
                  command: |
                      docker build -t cypress/test-kitchensink -\\<<EOF
                      FROM << parameters.imageName >>
                      RUN echo "current user: $(whoami)"
                      ENV CI=1
                      WORKDIR /app
                      ENV CYPRESS_INTERNAL_FORCE_SCAFFOLD=1
                      RUN npm init --yes
                      RUN npm install --save-dev cypress
                      RUN ./node_modules/.bin/cypress verify
                      RUN echo '{}' > cypress.json
                      EOF

            - when:
                  condition: << parameters.chromeVersion >>
                  steps:
                      - run:
                            name: Test << parameters.chromeVersion >>
                            no_output_timeout: '1m'
                            command: docker run cypress/test-kitchensink ./node_modules/.bin/cypress run --browser chrome

            - when:
                  condition: << parameters.firefoxVersion >>
                  steps:
                      - run:
                            name: Test << parameters.firefoxVersion >>
                            no_output_timeout: '1m'
                            command: docker run cypress/test-kitchensink ./node_modules/.bin/cypress run --browser firefox

            - when:
                  condition: << parameters.edgeVersion >>
                  steps:
                      - run:
                            name: Test << parameters.edgeVersion >>
                            no_output_timeout: '1m'
                            command: docker run cypress/test-kitchensink ./node_modules/.bin/cypress run --browser edge

    test-included-image-versions:
        description: Testing pre-installed versions
        parameters:
            cypressVersion:
                type: string
                description: Cypress version to test, like "4.0.0"
            imageName:
                type: string
                description: Cypress included docker image to test
        steps:
            - run:
                  name: 'Print versions'
                  command: docker run -it --entrypoint cypress cypress/included:<< parameters.cypressVersion >> version

            - run:
                  name: 'Print info'
                  command: docker run -it --entrypoint cypress cypress/included:<< parameters.cypressVersion >> info

            - run:
                  name: 'Check Node version'
                  command: |
                      export NODE_VERSION=$(docker run --entrypoint node cypress/included:<< parameters.cypressVersion >> --version)
                      export CYPRESS_NODE_VERSION=$(docker run --entrypoint cypress cypress/included:<< parameters.cypressVersion >> version --component node)
                      echo "Included Node $NODE_VERSION"
                      echo "Cypress includes Node $CYPRESS_NODE_VERSION"
                      # "node --version" returns something like "v12.1.2"
                      # and "cypres version ..." returns just "12.1.2"
                      if [ "$NODE_VERSION" = "v$CYPRESS_NODE_VERSION" ]; then
                        echo "Node versions match"
                      else
                        echo "Node version mismatch 🔥"
                        # TODO make sure there are no extra characters in the versions
                        # https://github.com/cypress-io/cypress-docker-images/issues/411
                        # exit 1
                      fi

    test-included-image:
        description: Testing Docker image with Cypress pre-installed
        parameters:
            cypressVersion:
                type: string
                description: Cypress version to test, like "4.0.0"
            imageName:
                type: string
                description: Cypress included docker image to test
        steps:
            - run:
                  name: New test project and testing
                  no_output_timeout: '3m'
                  command: |
                      node --version
                      cd test-project

                      echo "Testing using Electron browser"
                      docker run -it -v $PWD:/e2e -w /e2e cypress/included:<< parameters.cypressVersion >>

                      echo "Testing using Chrome browser"
                      docker run -it -v $PWD:/e2e -w /e2e cypress/included:<< parameters.cypressVersion >> --browser chrome

    docker-push:
        description: Log in and push a given image to Docker hub
        parameters:
            imageName:
                type: string
                description: Docker image name to push
        steps:
            # before pushing, let's check again that the Docker Hub does not have the image
            # accidental rebuild and overwrite of an image is bad, since it can bump every tool
            # https://github.com/cypress-io/cypress/issues/6335
            - halt-if-docker-image-exists:
                  imageName: << parameters.imageName >>
            - run:
                  name: Pushing image << parameters.imageName >> to Docker Hub
                  command: |
                      echo "$DOCKERHUB_PASS" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
                      docker push << parameters.imageName >>

jobs:
    lint-markdown:
        executor:
            name: node/default
            tag: '12.22'
        steps:
            - checkout
            - node/install-packages:
                override-ci-command: yarn install --frozen-lockfile
            - run: npm run check:markdown

    build-base-image:
        machine:
            image: ubuntu-2004:202111-02
        parameters:
            dockerName:
                type: string
                description: Image name to build
                default: cypress/base
            dockerTag:
                type: string
                description: Image tag to build like "12.14.0"
        steps:
            - checkout
            - halt-if-docker-image-exists:
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
            - run:
                  name: building Docker image << parameters.dockerName >>:<< parameters.dockerTag >>
                  command: |
                      docker build -t << parameters.dockerName >>:<< parameters.dockerTag >> .
                  working_directory: base/<< parameters.dockerTag >>

            - test-base-image:
                  nodeVersion: v<< parameters.dockerTag >>
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
            - halt-on-branch
            - docker-push:
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

    build-browser-image:
        machine:
            image: ubuntu-2004:202111-02
        parameters:
            dockerName:
                type: string
                description: Image name to build
                default: cypress/browsers
            dockerTag:
                type: string
                description: Image tag to build like "node12.4.0-chrome76"
            chromeVersion:
                type: string
                default: ''
                description: Chrome version to expect in the base image, starts with "Google Chrome XX"
            firefoxVersion:
                type: string
                default: ''
                description: Firefox version to expect in the base image, starts with "Mozilla Firefox XX"
            edgeVersion:
                type: string
                default: ''
                description: Edge version to expect in the base image, starts with "Microsoft Edge"
        steps:
            - checkout
            - halt-if-docker-image-exists:
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
            - run:
                  name: building Docker image << parameters.dockerName >>:<< parameters.dockerTag >>
                  command: |
                      docker build -t << parameters.dockerName >>:<< parameters.dockerTag >> .
                  working_directory: browsers/<< parameters.dockerTag >>
            - test-browser-image:
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
                  chromeVersion: << parameters.chromeVersion >>
                  firefoxVersion: << parameters.firefoxVersion >>
                  edgeVersion: << parameters.edgeVersion >>
            - halt-on-branch
            - docker-push:
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

    build-included-image:
        machine:
            image: ubuntu-2004:202111-02
        parameters:
            dockerName:
                type: string
                description: Image name to build
                default: cypress/included
            dockerTag:
                type: string
                description: Image tag to build, should match Cypress version, like "3.8.1"
        steps:
            - checkout
            - halt-if-docker-image-exists:
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
            - run:
                  name: building Docker image << parameters.dockerName >>:<< parameters.dockerTag >>
                  command: |
                      docker build -t << parameters.dockerName >>:<< parameters.dockerTag >> .
                  working_directory: included/<< parameters.dockerTag >>

            - test-included-image-versions:
                  cypressVersion: << parameters.dockerTag >>
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

            - test-included-image:
                  cypressVersion: << parameters.dockerTag >>
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

            - halt-on-branch
            - docker-push:
                  imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

workflows:
    version: 2
    lint:
        jobs:
            - lint-markdown
`

const splitImageFolderName = (folderName) => {
  const [name, tag] = folderName.split("/")
  return { name, tag }
}

const getImageType = (image) => {
  return image.name.includes("base") ? "base" : image.name.includes("browser") ? "browser" : "included"
}
const formWorkflow = (image) => {
  let yml = `    build-${getImageType(image)}-images:
        jobs:
            - build-${getImageType(image)}-image:
                name: "${getImageType(image)} ${image.tag}"
                dockerTag: "${image.tag}"`

  // add browser versions
  if (getImageType(image) === "browser") {
    if (image.tag.includes("-chrome")) {
      yml =
        yml +
        `
                chromeVersion: "Google Chrome ${image.tag.match(/-chrome\d*/)[0].substring(7)}"`
    }

    if (image.tag.includes("-ff")) {
      yml =
        yml +
        `
                firefoxVersion: "Mozilla Firefox ${image.tag.match(/-ff\d*/)[0].substring(3)}"`
    }

    if (image.tag.includes("-edge")) {
      yml =
        yml +
        `
                edgeVersion: "Microsoft Edge"`
    }
  }
  return yml
}

const formAwsBuildWorkflow = (image) => {
  const identifier = camelCase(`${image.name}${image.tag}`)
  const imageFolder = image.name === "browser" ? "browsers" : image.name
  const job = `        - identifier: ${identifier}
          env:
            image: aws/codebuild/standard:5.0
            type: LINUX_CONTAINER
            privileged-mode: true
            compute-type: BUILD_GENERAL1_MEDIUM
            variables:
                IMAGE_REPO_NAME: "cypress/${imageFolder}"
                IMAGE_DIR: "${imageFolder}"
                IMAGE_TAG: "${image.tag}"\n`
  return job
}

const writeConfigFile = (image) => {
  const workflow = formWorkflow(image)
  const text = preamble.trim() + os.EOL + workflow
  fs.writeFileSync("circle.yml", text, "utf8")
  console.log("Generated circle.yml")
}

const writeBuildSpecConfigFile = (image) => {
  const workflow = formAwsBuildWorkflow(image)
  const text = awsCodeBuildPreamble.trim() + os.EOL + workflow + os.EOL + awsCodeBuildPostamble.trim()
  fs.writeFileSync("buildspec.yml", text, "utf8")
  console.log("Generated buildspec.yml \n")
}

const outputFolder = path.join(imageType, versionTag)
console.log("** outputFolder : %s", outputFolder)

const image = splitImageFolderName(outputFolder)
console.log("** image : %s \n", image)

writeConfigFile(image)
writeBuildSpecConfigFile(image)
