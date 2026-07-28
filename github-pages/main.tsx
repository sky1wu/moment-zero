import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("无法初始化游戏界面");
}

createRoot(root).render(<Home />);
