export const onErrorHandler = `
window.onerror = function(message, sourcefile, lineno, colno, error) {
  if (error === null) return false;
  alert("Message: " + message + " - Source: " + sourcefile + " Line: " + lineno + ":" + colno);
  console.error(error);
  return true;
};
`;
