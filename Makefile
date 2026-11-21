.PHONY: init up up-local down logs rebuild backup-db

init:
	bash scripts/init-env.sh

up:
	docker compose --env-file .env -f deploy/docker-compose.yml up -d --build

up-local:
	docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml up -d --build

down:
	docker compose --env-file .env -f deploy/docker-compose.yml down

logs:
	docker compose --env-file .env -f deploy/docker-compose.yml logs -f --tail=100

rebuild:
	docker compose --env-file .env -f deploy/docker-compose.yml build --no-cache && $(MAKE) up

backup-db:
	mkdir -p backups
	docker compose --env-file .env -f deploy/docker-compose.yml exec -T postgres pg_dump -U $${POSTGRES_USER:-lumina} $${POSTGRES_DB:-lumina} > backups/lumina_$$(date +%Y%m%d_%H%M%S).sql
