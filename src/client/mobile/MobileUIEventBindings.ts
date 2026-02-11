export function bindOpenHandlers(
  button: HTMLButtonElement,
  onOpen: () => void,
): void {
  button.addEventListener("click", onOpen);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    onOpen();
  });
}

export function bindPointerDownHandler(
  button: HTMLButtonElement,
  handler: () => void,
): void {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handler();
  });
}
