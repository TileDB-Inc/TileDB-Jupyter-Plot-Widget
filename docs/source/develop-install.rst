
Developer install
=================


To install a developer version of tiledb-plot-widget, you will first need to clone
the repository::

    git clone https://github.com/TileDB-Inc/TileDB-Jupyter-Plot-Widget
    cd TileDB-Jupyter-Plot-Widget

Next, install it with a develop install using pip::

    pip install -e .


If you are planning on working on the JS/frontend code, you should also do
a link installation of the extension::

    jupyter nbextension install [--sys-prefix / --user / --system] --symlink --py tiledb-plot-widget

    jupyter nbextension enable [--sys-prefix / --user / --system] --py tiledb-plot-widget

with the `appropriate flag`_. Or, if you are using Jupyterlab::

    jupyter labextension install .


.. links

.. _`appropriate flag`: https://jupyter-notebook.readthedocs.io/en/stable/extending/frontend_extensions.html#installing-and-enabling-extensions
