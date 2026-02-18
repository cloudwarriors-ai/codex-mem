"use strict";

import { DashboardController } from "/assets/client/controller.js";
import { getElements } from "/assets/client/dom.js";

void bootstrap();

async function bootstrap() {
  const controller = new DashboardController(getElements());
  await controller.init();
}
