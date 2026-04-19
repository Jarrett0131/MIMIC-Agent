import app from "./app";
import { PORT } from "./config";
import { writeStructuredLog } from "./logging/logger";

app.listen(PORT, () => {
  writeStructuredLog("server.start", {
    port: PORT,
    created_at: new Date().toISOString(),
  });
});
