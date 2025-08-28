export default {
  testEnvironment: "node",
  testRegex: "/tests/.*\\.(test|spec)?\\.(ts|tsx)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^\\.\\.\\/\\.\\.\\/InputHandler$":
      "<rootDir>/tests/__mocks__/InputHandler.ts",
    "^src/client/InputHandler$": "<rootDir>/tests/__mocks__/InputHandler.ts",
    "\\.(svg|png|jpe?g|gif|webp)$": "<rootDir>/tests/__mocks__/fileMock.ts",
    "^nanoid$": "<rootDir>/tests/__mocks__/nanoid.cjs",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.jest.json",
        astTransformers: {
          before: ["<rootDir>/tests/transformers/removeImportAttributes.cjs"],
        },
        diagnostics: {
          ignoreCodes: [2823], // <-- ignore "import attributes require esnext/nodenext" in tests
          warnOnly: true, // optional: logs as warnings instead of failing the run
        },
      },
    ],
  },

  transformIgnorePatterns: ["node_modules/(?!(node:)/)"],
  preset: "ts-jest/presets/default-esm",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageThreshold: {
    global: { branches: 0, functions: 0, lines: 0, statements: 0 },
  },
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
};
