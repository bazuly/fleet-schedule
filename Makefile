# Локальный запуск fleet-schedule.
# make        — список команд
# make up     — сайт на localhost
# make logs   — логи бэкенда
# make ngrok  — сайт и туннель наружу

COMPOSE := docker compose

# Порт сайта на хосте. Если в .env задан FRONTEND_PORT, берём его.
PORT := $(shell awk -F= '$$1=="FRONTEND_PORT" { gsub(/^[ \t"]+|[ \t"]+$$/, "", $$2); print $$2; exit }' .env 2>/dev/null)
ifeq ($(strip $(PORT)),)
PORT := 3000
endif

.DEFAULT_GOAL := help
.PHONY: help up logs ngrok

help:
	@echo "make up     — собрать и поднять сайт на http://localhost:$(PORT)"
	@echo "make logs   — логи бэкенда"
	@echo "make ngrok  — поднять сайт и открыть туннель ngrok"
	@echo "make down   — выключить контейнер"

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

down-volumes:
	$(COMPOSE) down --volumes

logs:
	$(COMPOSE) logs -f --tail=200 backend

ngrok:
	$(COMPOSE) up -d
	ngrok http $(PORT) --log stdout
