PORT ?= 5173

.PHONY: dev

# Web UI dev server with hot reload, reachable from the LAN (http://<this machine>:$(PORT)).
dev:
	npm run dev -- --host --port $(PORT)
