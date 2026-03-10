.DEFAULT_GOAL := dev

.PHONY: dev web server install build test

dev:
	@trap 'kill 0' INT TERM EXIT; \
	npm run dev:server & \
	npm run dev:web & \
	wait

web:
	@npm run dev:web

server:
	@npm run dev:server

install:
	@npm install

build:
	@npm run build

test:
	@npm run test
