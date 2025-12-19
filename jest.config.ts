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
    "^bad-words$": "<rootDir>/tests/__mocks__/bad-words.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["@swc/jest"],
  },

  transformIgnorePatterns: ["node_modules/(?!(node:)/)"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageThreshold: {
    global: {
      statements: 22.0,
      branches: 17.0,
      lines: 22.0,
      functions: 20.5,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
};
