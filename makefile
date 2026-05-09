PACKAGES := packages/smoltalk packages/smoltalk-llama-cpp

.PHONY: all install test publish

# Default: recurse make into every package
all test publish:
	@for pkg in $(PACKAGES); do $(MAKE) -C $$pkg $@ || exit $$?; done

install:
	pnpm install
