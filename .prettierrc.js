/**
 * Prettier Configuration for Huly-Vibe-Sync
 * 
 * Consistent code formatting across the project
 */

export default {
  // Line length
  printWidth: 100,
  
  // Indentation
  tabWidth: 2,
  useTabs: false,
  
  // Quotes
  singleQuote: true,
  quoteProps: 'as-needed',
  
  // Trailing commas
  trailingComma: 'es5',
  
  // Semicolons
  semi: true,
  
  // Spacing
  bracketSpacing: true,
  arrowParens: 'always',
  
  // Line endings
  endOfLine: 'lf',
  
  // Object/Array formatting
  bracketSameLine: false,
  
  // File overrides
  overrides: [
    {
      files: '*.json',
      options: {
        printWidth: 80,
      },
    },
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always',
      },
    },
  ],
};
