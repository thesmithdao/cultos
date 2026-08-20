import { render } from "ink";
import React from "react";
import { Gallery, JobRoom } from "./ui.js";

export async function runDemo(): Promise<void> {
  const instance = render(<JobRoom />);
  await instance.waitUntilExit();
}

export async function runGallery(): Promise<void> {
  const instance = render(<Gallery />);
  await instance.waitUntilExit();
}
