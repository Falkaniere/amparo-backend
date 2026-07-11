module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  setupFiles: ['./jest.setup.js'],
  forceExit: true,
  moduleNameMapper: {
    '^#middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^#routes/(.*)$': '<rootDir>/src/routes/$1',
    '^#services/(.*)$': '<rootDir>/src/services/$1',
    '^#utils/(.*)$': '<rootDir>/src/utils/$1',
  },
};
