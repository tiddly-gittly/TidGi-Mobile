declare module '*.html' {
  const value: number;
  /**
   * Expo asset moduleIds
   * use .html to prevent include its content directly in the bundle. Only .html will be recognized as asset, .txt will say "not exist"
   */
  export default value;
}
