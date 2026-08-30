declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.css' {
  const classes: Record<string, string>;
  export default classes;
}