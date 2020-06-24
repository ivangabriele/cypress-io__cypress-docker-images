<!-- WARNING: this file was autogenerated by generate-base-image.js -->
# cypress/base:12.16.2

A Docker image with all dependencies pre-installed.
Just add your NPM packages (including Cypress) and run the tests.
See [Cypress Docker docs](https://on.cypress.io/docker) and
[Cypress CI guide](https://on.cypress.io/ci).

```
node version:    v12.16.2
npm version:     6.14.5
yarn version:    1.22.4
debian version:  10.3
user:            root
```

## Example

Sample Dockerfile

```
FROM cypress/base:12.16.2
RUN npm install --save-dev cypress
RUN $(npm bin)/cypress verify
RUN $(npm bin)/cypress run
```