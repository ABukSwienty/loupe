install-frontend:
	cd frontend && npm install

install-backend:
	cd backend && npm install

install-workers:
	cd workers && uv sync

install-deps:
	$(MAKE) install-frontend  && $(MAKE) install-backend && $(MAKE) install-workers

download-models:
	cd workers && HF_HUB_OFFLINE=0 uv run python src/download_models.py

install:
	$(MAKE) install-deps && $(MAKE) download-models

dev-workers:
	cd workers && uv run fastapi dev src/main.py

dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && npm run start:dev
