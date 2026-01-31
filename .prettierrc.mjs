/**
 * @type {import('prettier').Options}
 */
export default {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  jsxSingleQuote: false,
  singleQuote: false,
  arrowParens: "always",
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  plugins: [
    "prettier-plugin-sort-json",
    "prettier-plugin-packagejson",
    "prettier-plugin-organize-imports",
  ],
};
